import { ConnectorError } from "@crabgic/contracts";
import { validateAdfSafeSubset, type AdfDocument, type AdfNode } from "@crabgic/renderer";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { containsSecretShapedContent } from "../security/secret-patterns.js";

/**
 * HIGH H1 (adversarial-review): "every Jira Cloud comment/description
 * render goes through [17's ADF safe-subset conversion]; this phase
 * never emits raw ADF" (roadmap/18 §Interfaces consumed from 17) and
 * "17's lint runs on every outgoing payload" (§Test plan, Security
 * bullet) were only honored by `../intake/intake-engine.ts` /
 * `../intake/milestone-sync.ts` — the generic dispatch path and the
 * resource-client's own `issues`/`comments` plan builders passed a
 * caller-supplied `bodyAdf`/`summaryAdf`/`fields.description` straight
 * through, unvalidated, all the way into the outbound POST/PUT body.
 *
 * `assertSafeAdfDocument` is the ONE call site that closes that gap —
 * called at BOTH the plan-build boundary (`./issue-plans.ts`,
 * `./comment-worklog-attachment-plans.ts`) and, independently, at the
 * apply boundary (`./jira-mutation-apply-client.ts`'s `buildRequest`) —
 * so no entry point (a forged `tracker.plan_comment` call, a directly-
 * constructed plan bypassing the typed builders, a tampered payload-
 * registry entry) can get an unsafe ADF document into a real Jira
 * request. Fails closed on any of:
 *
 *  - not even a minimal `{type:"doc", content:[...]}` shape.
 *  - a disallowed node/mark type or unsafe (non-`https:`) link href
 *    (`@crabgic/renderer`'s own `validateAdfSafeSubset` — never re-derived
 *    here).
 *  - secret-shaped plain text extracted from the document (this
 *    connector's own addition — `validateAdfSafeSubset` only checks
 *    structural safety, not content; see `../security/secret-
 *    patterns.ts`, the same pattern set `../attachments/attachment-
 *    pipeline.ts` scans attachment bytes/filenames against).
 *  - secret-shaped content ANYWHERE in the document's JSON
 *    serialization — see the hardening note below.
 *
 * HARDENING (secret scan scope): the extracted-text scan above sees only
 * `node.text`. Two shapes therefore transited it untouched:
 *
 *  - a link mark's `attrs.href`. `validateAdfSafeSubset` checks a href's
 *    SCHEME only (`../../../renderer/src/adf.ts`'s `isSafeHref`) — a
 *    perfectly well-formed `https:` URL with a secret in its query string
 *    is structurally valid, and this deliberate scheme-vs-content division
 *    of labour means neither side was scanning it.
 *  - an unknown extra member on a node (`{type:"text", text:"hi",
 *    note:"AKIA..."}`). `validateAdfSafeSubset` walks only
 *    `type`/`marks`/`content`, so unknown members are structurally
 *    invisible — yet Cloud's `./jira-mutation-apply-client.ts` spreads the
 *    payload record wholesale into the request body, so they ship.
 *
 * Both reach a real Jira request: on Cloud the outbound body IS
 * `JSON.stringify` of this same document, and on Data Center the href is
 * emitted literally inside the wiki `[text|href]` construct
 * (`./datacenter/wiki-markup-render-profile.ts`). Scanning the whole
 * serialization therefore covers exactly the bytes that ship, and closes
 * both shapes by construction rather than enumerating attribute names —
 * an href-only check would leave the unknown-member path open.
 *
 * The extracted-text scan is KEPT, never replaced: `JSON.stringify`
 * escapes control characters, so a pattern like `aws_secret_access_key\s*=`
 * matching across a real newline no longer matches once that newline has
 * become the two-character escape `\n`. Serialization-only scanning would
 * be strictly WEAKER on the text path; the union is strictly stronger than
 * either alone. (See `../security/secret-patterns.ts`.)
 *
 * Never echoes the raw document or the matched secret text in the
 * thrown error — only a bounded, structural finding summary.
 *
 * MINOR-1 fix (adversarial-review, phase 19): this guard runs on the
 * Data Center path too — 19's DC resource client reuses `./issue-plans.ts`/
 * `./comment-worklog-attachment-plans.ts` VERBATIM (so their internal
 * calls here still default to Cloud attribution — a known, documented
 * residual gap for that specific plan-BUILD call path, see
 * docs/evidence/phase-19/README.md), and 19's own DC apply client
 * (`./datacenter/jira-mutation-apply-client-dc.ts`) re-checks at the
 * apply boundary, explicitly passing its own provider name. `provider`
 * below is an OPTIONAL third parameter, defaulting to `JIRA_PROVIDER_NAME`
 * — every existing (phase-18) call site's behavior is byte-for-byte
 * unchanged; only a caller that explicitly passes a different provider
 * name gets its `ConnectorError`s attributed to that name instead.
 */
function isAdfDocumentShape(value: unknown): value is AdfDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate["type"] === "doc" && Array.isArray(candidate["content"]);
}

function extractPlainText(node: AdfNode, into: string[]): void {
  if (typeof node.text === "string") {
    into.push(node.text);
  }
  for (const child of node.content ?? []) {
    extractPlainText(child, into);
  }
}

/**
 * `JSON.stringify` throws `TypeError` on a circular structure. This guard's
 * documented contract is that it throws only typed `ConnectorError`s, and a
 * document we cannot serialize is a document we cannot scan — so failing
 * closed (reject) is the only safe mapping. Never returns the document.
 *
 * Residual, stated rather than implied: a cycle routed through `content`
 * exhausts the stack inside the shared recursive walkers above long before
 * reaching here, and surfaces as a `RangeError`. That is pre-existing
 * behaviour of `validateAdfSafeSubset`/`extractPlainText`, not of this
 * check; it is pinned by a test in `./adf-guard.test.ts` so it cannot drift
 * silently. Cycles through members those walkers skip (e.g. `attrs`) do
 * reach here and are mapped below.
 */
function serializeForSecretScan(candidate: AdfDocument, label: string, provider: string): string {
  try {
    return JSON.stringify(candidate);
  } catch {
    throw ConnectorError.policyBlocked({
      message: `${label}: ADF document is not JSON-serializable (circular or otherwise unencodable structure) — refusing to emit an unscannable document`,
      provider,
      retryable: false,
    });
  }
}

export function assertSafeAdfDocument(
  candidate: unknown,
  label: string,
  provider: string = JIRA_PROVIDER_NAME,
): AdfDocument {
  if (!isAdfDocumentShape(candidate)) {
    throw ConnectorError.policyBlocked({
      message: `${label}: expected a safe-subset ADF document ({type:"doc", content:[...]}), got an invalid or missing shape`,
      provider,
      retryable: false,
    });
  }

  const findings = validateAdfSafeSubset(candidate);
  if (findings.length > 0) {
    throw ConnectorError.policyBlocked({
      message: `${label}: ADF safe-subset validation failed (${findings.length} finding(s)): ${findings
        .map((finding) => finding.message)
        .join("; ")}`,
      provider,
      retryable: false,
    });
  }

  const textParts: string[] = [];
  for (const node of candidate.content) {
    extractPlainText(node, textParts);
  }
  if (containsSecretShapedContent(textParts.join("\n"))) {
    throw ConnectorError.policyBlocked({
      message: `${label}: embedded secret-shaped content detected in ADF text`,
      provider,
      retryable: false,
    });
  }

  // Runs AFTER the text scan, never instead of it — so a text-borne secret
  // keeps its existing, more specific message and the `\s`-bearing patterns
  // keep an unescaped subject to match against. Deliberately scans the whole
  // serialization rather than an enumerated attribute list; see the module
  // doc comment. `candidate` is never mutated — the same object is returned.
  if (containsSecretShapedContent(serializeForSecretScan(candidate, label, provider))) {
    throw ConnectorError.policyBlocked({
      message: `${label}: embedded secret-shaped content detected in ADF document serialization`,
      provider,
      retryable: false,
    });
  }

  return candidate;
}
