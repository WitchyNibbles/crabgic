/**
 * `path-anchor.live.test` — THE OWED PROBE (03 carry-forward; README decision
 * 6; `options-assembler.ts`'s ENGINE-FACT-DRIFT note). Empirically determines
 * which substituted owned-path rule form the REAL pinned engine honors:
 *
 *   - triple-slash `Write(///abs/worktree/owned/**)` — the CURRENT form, from
 *     literal substitution of the absolute worktree path into the compiler's
 *     `//<worktree>/**` template (this is what the committed goldens emit).
 *   - double-slash `Write(//abs/worktree/owned/**)` — the alternative, one
 *     leading slash stripped.
 *
 * Probed via DIRECT query with explicit permission rules (baseline §3's
 * permission-probe shape) and NO sandbox, so only the permission-rule
 * ANCHOR MATCHING decides — for EACH form, an allow-side (a Write INSIDE the
 * owned path must succeed under the rule form) and a deny-side (a Write
 * OUTSIDE the owned path must be denied), both executed-call-guarded.
 *
 * CONDITIONAL AUTHORITY (this worker's brief): if the triple-slash form fails
 * live (inside Write denied) and the double-slash form passes,
 * `substituteWorktreePlaceholders` in `src/options-assembler.ts` is fixed to
 * strip the duplicated slash, the goldens are regenerated, W1's unit tests are
 * kept green, and the resolution is documented in wi5-live.md + a code
 * comment citing this test. The assertions below encode the CURRENT
 * expectation (triple-slash honored); a failure here is the signal to
 * exercise that authority.
 *
 * ── MEASURED 2026-07-25 (live, pinned engine; artifact:
 * `docs/evidence/phase-06/path-anchor-determination.json`) ────────────────
 *
 * The authority above was NOT exercised. What these 20 recorded probes
 * establish — and ONLY this:
 *
 *   An ISOLATED path-scoped `Write(...)` rule, supplied ALONE against an
 *   otherwise minimal permission object and a single-segment owned path,
 *   was NOT honored. Not triple-slash, not double-slash, not
 *   plain-absolute, not cwd-relative — and not merely as a globbing problem
 *   either: an EXACT absolute filename (`Write(/abs/worktree/owned/
 *   inside.txt)`) did not match, nor did `/*` in place of `/**`. In that
 *   setup only the BARE, unanchored tool name `Write` matched, identically
 *   in BOTH channels a compiled profile's deny entries travel through
 *   (`settings.permissions.deny` and `Options.disallowedTools`), each with
 *   its own bare-`Write` control proving the channel was live.
 *
 * ── DO NOT GENERALIZE THAT (correction, same day) ─────────────────────────
 *
 * This header previously read the result above as "the engine honors NO
 * path-anchored form of a `Write(...)` rule; the compiler's anchoring is
 * inert at runtime". That generalization is RETRACTED.
 * `sandbox-containment.live.test.ts` (artifact
 * `docs/evidence/phase-06/sandbox-containment-determination.json`) then
 * measured the SAME triple-slash anchor form inside the COMPILER'S OWN full
 * permission object — `defaultMode: "dontAsk"`,
 * `disableBypassPermissionsMode: "disable"`, the populated `deny` array, no
 * bare `Write` anywhere, nested owned path `packages/example/src` — and it
 * demonstrably SCOPES: the in-owned-path Write is allowed while a Write one
 * directory up is denied, reproduced across four samples including
 * `compiled-profile-no-sandbox` (both `Options.sandbox` and
 * `settingsJson.sandbox` removed), which rules the sandbox out.
 *
 * Both results are real and were gathered with working controls; they
 * differ in SETUP, and WHICH difference is causal is UNDETERMINED — lone
 * rule vs. full permission object, deny-side vs. allow-side, single-segment
 * vs. nested owned path, target geometry. Do not assert one. The settled,
 * citable statement of both observations is `docs/engine-baseline.md` §14.
 *
 * Consequences, in order of importance:
 *
 *  1. NO production change is warranted — from EITHER result. The
 *     conditional authority fires only when the engine honors a form
 *     DIFFERENT from the one `substituteWorktreePlaceholders` emits. These
 *     probes honored no form in their setup, and the compiled-profile probe
 *     found the emitted triple-slash form working in production's own
 *     configuration. Neither points at a different form; the triple-slash
 *     form stays. In particular, the compiler's `//<worktree>/…/**`
 *     template must NOT be deleted or "simplified" as dead weight on the
 *     strength of this file — see baseline §14.4.
 *  2. These probes say nothing about owned-path CONFINEMENT in production.
 *     They ran with NO sandbox by design (see above) and with a hand-built
 *     permission object, so they say nothing about
 *     `sandbox.filesystem.allowWrite`, the adjudication callback, or the
 *     `assertNoFootguns` gate. `sandbox-containment.live.test.ts` is where
 *     the compiled shape is measured; whole-system containment remains a
 *     separate open question (baseline §11).
 *  3. The four allow-side probes below cannot answer this question at all
 *     and never could; the first `it` therefore still fails live. Its
 *     recorded dead end is deliberately preserved rather than inverted —
 *     see the block comment above the deny probes for why the allow shape
 *     measures tool ENABLEMENT rather than path anchoring. Note that the
 *     allow shape is precisely what the compiled profile exercises, which
 *     is one of the candidate explanations above.
 *
 * The probes and assertions below are UNCHANGED and remain correct about
 * what they measured. Read them as "in this setup", never as "in general".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  assertLiveEnabled,
  createLiveScratch,
  ensureCanary,
  guardRawRateLimit,
  resolveWorkerAuthMaterial,
  runDirectQuery,
  type LiveScratch,
} from "./live-harness.js";

interface WriteBlock {
  readonly filePath: string;
}

function writeAttempts(messages: readonly SDKMessage[]): readonly WriteBlock[] {
  const attempts: WriteBlock[] = [];
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    const content: unknown = (message as { readonly message?: { readonly content?: unknown } })
      .message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const typed = block as {
        readonly type?: unknown;
        readonly name?: unknown;
        readonly input?: unknown;
      };
      if (typed.type === "tool_use" && typed.name === "Write") {
        const filePath = (typed.input as { readonly file_path?: unknown } | null)?.file_path;
        if (typeof filePath === "string") {
          attempts.push({ filePath });
        }
      }
    }
  }
  return attempts;
}

function permissionDenialCount(messages: readonly SDKMessage[]): number {
  const result = messages.find((message) => message.type === "result") as
    { readonly permission_denials?: readonly unknown[] } | undefined;
  return result?.permission_denials?.length ?? 0;
}

interface AnchorProbeOutcome {
  readonly insideAttempted: boolean;
  readonly insideAllowed: boolean;
  readonly outsideAttempted: boolean;
  readonly outsideDenied: boolean;
}

/** The two-Write diagnostic instruction both probe shapes issue verbatim, so allow-probe and deny-probe transcripts differ ONLY in their permission configuration. */
function buildTwoWritePrompt(insidePath: string, outsidePath: string): string {
  return (
    "You are a CI filesystem-permissions diagnostic step. Use the Write tool exactly twice, " +
    `attempting both regardless of any error: (1) create the file ${insidePath} with the ` +
    `content PROBE-INSIDE; (2) create the file ${outsidePath} with the content PROBE-OUTSIDE. ` +
    "A permission denial on one of them is an EXPECTED possible outcome — attempt both and report which succeeded."
  );
}

async function probeAnchorForm(
  scratch: LiveScratch,
  ruleForm: string,
): Promise<AnchorProbeOutcome> {
  const insidePath = join(scratch.worktreePath, "owned", "inside.txt");
  const outsidePath = join(scratch.worktreePath, "outside.txt");
  const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
    prompt: buildTwoWritePrompt(insidePath, outsidePath),
    cwd: scratch.worktreePath,
    configDir: scratch.configDir,
    homeDir: scratch.homeDir,
    tmpDir: scratch.tmpDir,
    // The rule carries BOTH enablement and scope — it is the single thing
    // under test, so nothing else may grant `Write`.
    //
    // Probing history worth keeping, because each dead end looks like a
    // result: passing a bare `Write` in `allowedTools` alongside the rule
    // does make the inside write succeed, but it also makes the OUTSIDE
    // write succeed (blanket enablement, rule ignored) — a probe that can
    // no longer fail on the deny-side is measuring nothing.
    allow: [ruleForm],
    allowedTools: [ruleForm],
    maxTurns: 4,
  });
  guardRawRateLimit(result.messages);

  const attempts = writeAttempts(result.messages);
  const insideAttempted = attempts.some((attempt) => attempt.filePath.includes("inside.txt"));
  const outsideAttempted = attempts.some((attempt) => attempt.filePath.includes("outside.txt"));
  return {
    insideAttempted,
    // Allow-side: the inside file was actually created (the rule form matched).
    insideAllowed: existsSync(insidePath),
    outsideAttempted,
    // Deny-side: the outside file was NOT created, and at least one denial was recorded.
    outsideDenied: !existsSync(outsidePath) && permissionDenialCount(result.messages) > 0,
  };
}

// ---------------------------------------------------------------------------
// DENY-path probe (2026-07-25) — the shape that can actually measure anchoring
// ---------------------------------------------------------------------------

/**
 * Outcome of a DENY probe. Read it with the opposite polarity to
 * `AnchorProbeOutcome`: here `insideDenied` is the positive signal (the
 * candidate form MATCHED the in-owned-path Write) and `outsideAllowed` is the
 * control (the denial was scoped, not blanket).
 */
interface DenyAnchorProbeOutcome {
  readonly insideAttempted: boolean;
  /** The candidate form MATCHED: the in-owned-path Write was refused and a permission denial was recorded. */
  readonly insideDenied: boolean;
  readonly outsideAttempted: boolean;
  /** Control: the out-of-owned-path Write still succeeded, proving `Write` was broadly enabled and the denial (if any) came from the scoped deny rule. */
  readonly outsideAllowed: boolean;
}

/**
 * The probe shape that isolates ANCHOR MATCHING, added after the four
 * allow-side probes above all came back identical (see the `describe`'s
 * closing note): `permissions.allow` only ever GRANTS, so an allow-scoped
 * probe cannot produce a denial attributable to a path anchor at all — its
 * "outsideDenied" signal was `Write` being disabled outright.
 *
 * Here `Write` is enabled BROADLY (bare `Write` in both `allowedTools` and
 * `permissions.allow`) and the candidate form is the ONLY entry in
 * `permissions.deny`. A denial can then come from exactly one place: the deny
 * rule matching. This is also the shape production actually depends on —
 * phase 03's compiled envelope carries `Edit`/`Write` DENY backstop entries
 * rather than relying on allow-scoping.
 *
 * NOTE on `settings` composition: `runDirectQuery` spreads `spec.settings`
 * AFTER its own `{ permissions: { allow: [...spec.allow] } }`, so a
 * `permissions` key supplied here REPLACES that object wholesale. `spec.allow`
 * is therefore deliberately not passed — the bare `Write` allow entry is
 * carried inside this object instead, or it would be silently dropped.
 */
/**
 * Which of the two channels a compiled profile's deny entries travel through
 * carries the rule under test. `assembleWorkerOptions` emits the SAME array as
 * both `settings.permissions.deny` and `Options.disallowedTools`, so "is this
 * anchor form honored?" is a per-channel question and both must be probed
 * before any claim about production's confinement can be made.
 */
type DenyChannel = "settings-deny" | "disallowed-tools";

async function probeDenyAnchorForm(
  scratch: LiveScratch,
  ruleForm: string,
  channel: DenyChannel = "settings-deny",
): Promise<DenyAnchorProbeOutcome> {
  const insidePath = join(scratch.worktreePath, "owned", "inside.txt");
  const outsidePath = join(scratch.worktreePath, "outside.txt");
  const result = await runDirectQuery(resolveWorkerAuthMaterial(), {
    prompt: buildTwoWritePrompt(insidePath, outsidePath),
    cwd: scratch.worktreePath,
    configDir: scratch.configDir,
    homeDir: scratch.homeDir,
    tmpDir: scratch.tmpDir,
    allowedTools: ["Write"],
    ...(channel === "settings-deny"
      ? { settings: { permissions: { allow: ["Write"], deny: [ruleForm] } } }
      : { settings: { permissions: { allow: ["Write"] } }, disallowedTools: [ruleForm] }),
    maxTurns: 4,
  });
  guardRawRateLimit(result.messages);

  const attempts = writeAttempts(result.messages);
  return {
    insideAttempted: attempts.some((attempt) => attempt.filePath.includes("inside.txt")),
    insideDenied: !existsSync(insidePath) && permissionDenialCount(result.messages) > 0,
    outsideAttempted: attempts.some((attempt) => attempt.filePath.includes("outside.txt")),
    outsideAllowed: existsSync(outsidePath),
  };
}

/**
 * Where this probe's verdict is written. The determination is the whole
 * point of the test — a pass/fail alone cannot express it, because the
 * double-slash probe deliberately asserts only its deny-side and merely
 * OBSERVES its allow-side (asserting it would presuppose the answer this
 * test exists to discover). A 2026-07-25 live run showed the triple-slash
 * allow-side failing, and the tie-breaker it needed — whether double-slash
 * allows — was recorded nowhere and so was unavailable without re-running
 * against a paid engine. Both probes now persist their full outcome here.
 */
const DETERMINATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "docs",
  "evidence",
  "phase-06",
  "path-anchor-determination.json",
);

interface AnchorFormRecord {
  readonly rule: string;
  readonly insideAttempted: boolean;
  readonly insideAllowed: boolean;
  readonly outsideAttempted: boolean;
  readonly outsideDenied: boolean;
}

/**
 * The artifact carries BOTH probe shapes, whose fields mean OPPOSITE things —
 * an allow-probe's positive signal is `insideAllowed`, a deny-probe's is
 * `insideDenied`. Persisted alongside the forms so a later reader cannot
 * misread one as the other. Unprefixed keys are allow probes; `deny-*` keys
 * are deny probes.
 */
const DETERMINATION_LEGEND = {
  "allow-probe (unprefixed keys)":
    "The candidate form was the ONLY entry in both allowedTools and settings.permissions.allow. " +
    "insideAllowed=true would mean the form matched. Every form recorded insideAllowed=false AND " +
    "outsideDenied=true — identically — because permissions.allow only GRANTS: with no bare Write " +
    "in allowedTools the Write tool was disabled outright (under permissionMode 'dontAsk' a tool in " +
    "no allow rule is auto-denied, docs/engine-baseline.md §3). These entries therefore measure tool " +
    "ENABLEMENT, not path anchoring, and settle nothing about anchor form.",
  "deny-probe (deny-* keys)":
    "Write is enabled broadly (bare 'Write' in allowedTools and in settings.permissions.allow) and " +
    "the candidate form is the ONLY entry in settings.permissions.deny. insideDenied=true means the " +
    "form MATCHED the in-owned-path Write; outsideAllowed=true is the control proving the denial was " +
    "scoped rather than blanket. Deny is the only thing that can produce a denial here, so this shape " +
    "measures anchoring directly — and it is the shape production depends on, since phase 03's " +
    "compiled envelope carries Edit/Write DENY backstop entries rather than relying on allow-scoping.",
} as const;

/** Reads the artifact's current `forms` map, tolerating an absent/corrupt file. */
function readExistingForms(): Record<string, unknown> {
  if (!existsSync(DETERMINATION_PATH)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(DETERMINATION_PATH, "utf8")) as {
      forms?: Record<string, unknown>;
    };
    return parsed.forms ?? {};
  } catch {
    // A malformed artifact from an interrupted run must never fail the
    // probe itself — the live engine result is the expensive part.
    return {};
  }
}

/** Merges one probed form's record into the shared determination artifact — every probe is its own `it` block, so none can see another's result in memory. */
function mergeDetermination(key: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(DETERMINATION_PATH), { recursive: true });
  writeFileSync(
    DETERMINATION_PATH,
    `${JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        legend: DETERMINATION_LEGEND,
        forms: { ...readExistingForms(), [key]: record },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** Records one ALLOW-shaped probe (the candidate form carries both enablement and scope). */
function recordAnchorOutcome(form: string, rule: string, outcome: AnchorProbeOutcome): void {
  const record: AnchorFormRecord = {
    // The absolute worktree path is a per-run temp dir; recorded so
    // the rule form is legible, and it carries nothing sensitive.
    rule,
    insideAttempted: outcome.insideAttempted,
    insideAllowed: outcome.insideAllowed,
    outsideAttempted: outcome.outsideAttempted,
    outsideDenied: outcome.outsideDenied,
  };
  mergeDetermination(form, { probe: "allow", ...record });
}

/** Records one DENY-shaped probe. `insideDenied` is the determination; `outsideAllowed` is the control. */
function recordDenyAnchorOutcome(
  form: string,
  rule: string,
  outcome: DenyAnchorProbeOutcome,
  channel: DenyChannel = "settings-deny",
): void {
  mergeDetermination(`deny-${form}`, {
    probe: "deny",
    channel,
    rule,
    insideAttempted: outcome.insideAttempted,
    insideDenied: outcome.insideDenied,
    outsideAttempted: outcome.outsideAttempted,
    outsideAllowed: outcome.outsideAllowed,
    matched: outcome.insideDenied,
  });
}

beforeAll(async () => {
  assertLiveEnabled();
  await ensureCanary();
});

describe("owned-path rule anchor form honored by the real engine (03 carry-forward)", () => {
  /**
   * RETIRED EXPECTATION, kept as a REGRESSION DETECTOR (2026-07-25).
   *
   * This probe used to assert that the triple-slash form honors its allow —
   * the phase-03 expectation. Twenty live probes across both permission
   * channels measured the opposite IN THIS SETUP: an isolated path-scoped
   * rule, supplied alone, was honored in neither channel (see this file's
   * header and the determination artifact). Leaving the old assertion in
   * place would hold the `engine-live` job permanently red against an
   * outcome that is now recorded, which teaches everyone to ignore it.
   *
   * So the assertion is INVERTED rather than deleted, and it still earns its
   * live run: if a future engine version starts honoring an isolated path
   * anchor in THIS configuration, this goes red — which is both a real
   * engine change and the collapse of one candidate explanation for why the
   * compiled profile scopes and this shape does not (header, "DO NOT
   * GENERALIZE"). Either way, someone must revisit
   * `substituteWorktreePlaceholders` and baseline §14. The executed-call
   * guards are unchanged; without them "not allowed" could mean "never
   * attempted".
   */
  it("the triple-slash form is NOT honored — the settled determination, asserted so a reversal goes red", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      // worktreePath already starts with '/', so `//${W}/owned/**` yields the
      // triple-slash literal `Write(///abs/worktree/owned/**)` the goldens emit.
      const tripleRule = `Write(//${scratch.worktreePath}/owned/**)`;
      const outcome = await probeAnchorForm(scratch, tripleRule);
      // Recorded BEFORE the assertions below, so a failing run still leaves
      // its verdict on disk instead of taking it down with the throw.
      recordAnchorOutcome("triple-slash", tripleRule, outcome);

      // Executed-call guards: both Write attempts must have actually happened.
      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
        true,
      );

      expect(
        outcome.insideAllowed,
        "REVERSAL: the engine now HONORS the triple-slash path-anchored allow rule supplied ALONE. " +
          "That contradicts what this suite recorded — an isolated path-scoped Write(<pattern>) rule " +
          "was not honored, in either channel — while the same form inside the compiler's full " +
          "permission object DID scope (docs/evidence/phase-06/sandbox-containment-determination." +
          "json). Re-open the anchor question, and update docs/engine-baseline.md §14, whose two " +
          "observations this result would reconcile.",
      ).toBe(false);
    } finally {
      await scratch.cleanup();
    }
  });

  it("the alternative double-slash form is probed for the record (deny-side must hold regardless)", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      // One leading slash stripped: `/${W}/owned/**` yields `Write(//abs/worktree/owned/**)`.
      const doubleRule = `Write(/${scratch.worktreePath}/owned/**)`;
      const outcome = await probeAnchorForm(scratch, doubleRule);
      recordAnchorOutcome("double-slash", doubleRule, outcome);

      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
        true,
      );
      // Deny-side must hold for either form (a non-matching allow denies the outside write).
      expect(outcome.outsideDenied, "an out-of-owned-path Write was NOT denied").toBe(true);
      // insideAllowed for the double-slash form is recorded (not asserted) — it
      // is the tie-breaker the conditional-authority decision reads if the
      // triple-slash allow-side test above fails. See wi5-live.md.
    } finally {
      await scratch.cleanup();
    }
  });

  /**
   * Added 2026-07-25, after the first real run answered the original
   * two-way question with "NEITHER": both the triple-slash and the
   * double-slash form denied the in-owned-path Write (deny-side held for
   * both, so the failure is closed, not open). That falsifies the premise
   * both original probes shared — that the leading `//` is part of the
   * anchor syntax and only the slash COUNT was in question.
   *
   * This probes the form neither of them covered: the plain absolute path,
   * exactly as the engine's own permission documentation writes it. If the
   * allow-side holds here, the compiler's `//<worktree>/**` template is
   * simply wrong and `substituteWorktreePlaceholders` should emit a plain
   * absolute path.
   */
  it("the plain single-slash absolute form is probed — the case neither original form covered", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      // `worktreePath` already starts with '/', so this yields the plain
      // `Write(/abs/worktree/owned/**)` with no doubled prefix at all.
      const plainRule = `Write(${scratch.worktreePath}/owned/**)`;
      const outcome = await probeAnchorForm(scratch, plainRule);
      recordAnchorOutcome("plain-absolute", plainRule, outcome);

      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
        true,
      );
      // Deny-side must hold for every form — a non-matching allow denies the
      // outside write regardless of which anchor syntax is correct.
      expect(outcome.outsideDenied, "an out-of-owned-path Write was NOT denied").toBe(true);
      // Allow-side is RECORDED, not asserted, for the same reason the
      // double-slash probe records its own: asserting it would presuppose
      // the answer this suite exists to discover.
    } finally {
      await scratch.cleanup();
    }
  });

  /**
   * The cwd-RELATIVE form, added last because the three absolute variants
   * all denied and the engine's own permission documentation writes these
   * patterns relative to the working directory (gitignore-style), not as
   * absolute globs. `runDirectQuery` sets `cwd` to the worktree root, so
   * `owned/**` addresses exactly the same files the absolute forms tried to.
   *
   * If this is the form that both allows inside and denies outside, then the
   * compiler's `//<worktree>/**` template is wrong in kind rather than in
   * slash-count, and `substituteWorktreePlaceholders` should emit a
   * worktree-relative pattern.
   */
  it("the cwd-relative form is probed — the engine documents these patterns relative to cwd", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      const relativeRule = "Write(owned/**)";
      const outcome = await probeAnchorForm(scratch, relativeRule);
      recordAnchorOutcome("cwd-relative", relativeRule, outcome);

      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
        true,
      );
      // Deny-side must hold for every form.
      expect(outcome.outsideDenied, "an out-of-owned-path Write was NOT denied").toBe(true);
    } finally {
      await scratch.cleanup();
    }
  });

  /**
   * ── The DENY probes (2026-07-25) ──────────────────────────────────────
   *
   * The four allow probes above returned the SAME answer for every
   * candidate form — inside denied, outside denied — which is exactly what
   * a probe that measures nothing looks like. A follow-up run pinned down
   * why: with a bare `Write` in `allowedTools` and the rule in
   * `settings.permissions.allow`, the inside write succeeded but so did the
   * OUTSIDE write. `permissions.allow` only GRANTS; it never RESTRICTS.
   * So the "outsideDenied=true" every allow probe reported came from the
   * `Write` tool being disabled outright (under `permissionMode: "dontAsk"`
   * a tool in no allow rule is auto-denied — docs/engine-baseline.md §3),
   * not from path-anchor matching. Those four entries are kept as the audit
   * trail of a probe shape that could not answer the question.
   *
   * These probes remove the confound: `Write` enabled broadly, the
   * candidate form as the ONLY `permissions.deny` entry, and a Write
   * attempted INSIDE the owned directory. A denial can then only come from
   * the deny rule matching. This is also the mechanism production actually
   * relies on — phase 03's compiled envelope carries `Edit`/`Write` DENY
   * backstop entries, so "which form does a DENY rule match?" is the
   * determination that governs `substituteWorktreePlaceholders`.
   */
  /**
   * VACUITY CONTROL for the four deny probes below, and the reason they
   * assert nothing about `insideDenied` on their own.
   *
   * A deny probe reports `insideDenied=false` in two very different worlds:
   * the candidate form did not MATCH, or the deny rule never reached the
   * engine's permission layer at all (an inert `settings` passthrough, or
   * `allowedTools` outranking `settings.permissions.deny`). Those are
   * indistinguishable from the outcome alone — precisely the vacuous pass
   * the executed-call guards exist to prevent, one level up.
   *
   * This probe pins the channel down with a rule whose matching cannot be in
   * question: a BARE `Write` deny, no path anchor at all, against the same
   * broadly-enabled `Write`. If the in-owned-path write is denied here, the
   * deny channel demonstrably reaches the engine and outranks `allowedTools`,
   * so a `insideDenied=false` from a path-anchored form is a real
   * non-match. If it is NOT denied, every deny-form result below is
   * uninterpretable and no production change may be drawn from them.
   */
  it("DENY probe CONTROL: a bare, unanchored Write deny must actually deny (proves the channel is live)", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      const bareRule = "Write";
      const outcome = await probeDenyAnchorForm(scratch, bareRule);
      recordDenyAnchorOutcome("control-bare-tool", bareRule, outcome);

      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(
        outcome.insideDenied,
        "DENY CHANNEL IS INERT: a bare `Write` entry in settings.permissions.deny did not deny an " +
          "in-owned-path Write, so settings.permissions.deny never reached the engine's permission " +
          "layer (or allowedTools outranks it). Every deny-form probe below is therefore vacuous and " +
          "settles nothing about anchor matching.",
      ).toBe(true);
    } finally {
      await scratch.cleanup();
    }
  });

  const DENY_FORMS: ReadonlyArray<{
    readonly form: string;
    readonly describeIt: string;
    readonly buildRule: (worktreePath: string) => string;
  }> = [
    {
      form: "triple-slash",
      describeIt: "the CURRENT triple-slash form — what the committed goldens emit",
      buildRule: (worktreePath) => `Write(//${worktreePath}/owned/**)`,
    },
    {
      form: "double-slash",
      describeIt: "the double-slash form — one leading slash stripped",
      buildRule: (worktreePath) => `Write(/${worktreePath}/owned/**)`,
    },
    {
      form: "plain-absolute",
      describeIt: "the plain absolute form — as the engine's own docs write it",
      buildRule: (worktreePath) => `Write(${worktreePath}/owned/**)`,
    },
    {
      form: "cwd-relative",
      describeIt: "the cwd-relative form — gitignore-style, relative to the worktree root",
      buildRule: () => "Write(owned/**)",
    },
  ];

  for (const { form, describeIt, buildRule } of DENY_FORMS) {
    it(`DENY probe: ${describeIt}`, async () => {
      const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
      try {
        const rule = buildRule(scratch.worktreePath);
        const outcome = await probeDenyAnchorForm(scratch, rule);
        // Recorded BEFORE the assertions, so a surprising outcome still
        // leaves its verdict on disk instead of going down with the throw.
        recordDenyAnchorOutcome(form, rule, outcome);

        // Executed-call guards: no conclusion may be drawn from an outcome
        // whose Write was never attempted (vacuous-pass guard).
        expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
        expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
          true,
        );

        // Control: none of the four candidate forms scopes the worktree-ROOT
        // file, so the out-of-owned-path Write must succeed for EVERY form.
        // If it does not, `Write` was not broadly enabled and this probe is
        // back to measuring enablement rather than anchoring.
        expect(
          outcome.outsideAllowed,
          "CONTROL FAILED: the out-of-owned-path Write did not succeed, so Write was not broadly " +
            "enabled and any inside denial cannot be attributed to the deny rule's anchor",
        ).toBe(true);

        // `insideDenied` is the determination itself — RECORDED, not
        // asserted, because asserting it would presuppose the answer this
        // suite exists to discover. See the artifact's `legend`.
      } finally {
        await scratch.cleanup();
      }
    });
  }

  /**
   * SYNTAX DIAGNOSTICS, added once the four candidate forms all came back
   * `insideDenied=false` against a control that proved the deny channel
   * live. "No candidate form matched" is only actionable if we also know
   * whether ANY path-scoped `Write(...)` rule matches in this engine
   * version — otherwise "the goldens use the wrong anchor" and "path-scoped
   * Write rules are not honored at all" are indistinguishable, and they
   * imply opposite production changes.
   *
   * These vary ONE dimension at a time against the same in-owned-path
   * Write: the glob (`/**` vs `/*` vs an exact filename) crossed with the
   * anchor (`//abs` vs plain `/abs` vs cwd-relative). Recorded under
   * `deny-*` keys like the candidate forms; the control above covers all of
   * them for vacuity.
   */
  const DENY_SYNTAX_DIAGNOSTICS: ReadonlyArray<{
    readonly form: string;
    readonly buildRule: (worktreePath: string) => string;
  }> = [
    // `worktreePath` already starts with '/', so `//${wt}` is the TRIPLE-slash
    // literal and `/${wt}` is the DOUBLE-slash one — the same naming
    // convention the candidate forms above use. Every entry's exact literal is
    // persisted in the artifact's `rule` field, so the labels are checkable.
    { form: "exact-triple-slash", buildRule: (wt) => `Write(//${wt}/owned/inside.txt)` },
    { form: "exact-double-slash", buildRule: (wt) => `Write(/${wt}/owned/inside.txt)` },
    { form: "exact-plain-absolute", buildRule: (wt) => `Write(${wt}/owned/inside.txt)` },
    { form: "exact-cwd-relative", buildRule: () => "Write(owned/inside.txt)" },
    { form: "single-star-triple-slash", buildRule: (wt) => `Write(//${wt}/owned/*)` },
    { form: "single-star-double-slash", buildRule: (wt) => `Write(/${wt}/owned/*)` },
  ];

  for (const { form, buildRule } of DENY_SYNTAX_DIAGNOSTICS) {
    it(`DENY syntax diagnostic: ${form}`, async () => {
      const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
      try {
        const rule = buildRule(scratch.worktreePath);
        const outcome = await probeDenyAnchorForm(scratch, rule);
        recordDenyAnchorOutcome(form, rule, outcome);

        expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
        // `insideDenied`/`outsideAllowed` are recorded, not asserted — these
        // probes exist to map the syntax space, not to lock an expectation.
      } finally {
        await scratch.cleanup();
      }
    });
  }

  /**
   * The SECOND deny channel. `assembleWorkerOptions` emits the compiled deny
   * array TWICE — once as `settings.permissions.deny`, once as
   * `Options.disallowedTools` ("one compiled decision, two serializations").
   * Everything above probed only the first. A form unhonored in one channel
   * may still be honored in the other, and production's confinement holds if
   * EITHER does — so no verdict about production is sound until both are
   * measured. Same control-then-forms structure, so a `false` here is
   * likewise never read as "did not match" without the channel first being
   * shown live.
   */
  it("DENY probe CONTROL (disallowedTools channel): a bare, unanchored Write must actually deny", async () => {
    const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
    try {
      const bareRule = "Write";
      const outcome = await probeDenyAnchorForm(scratch, bareRule, "disallowed-tools");
      recordDenyAnchorOutcome("dt-control-bare-tool", bareRule, outcome, "disallowed-tools");

      expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
      expect(
        outcome.insideDenied,
        "disallowedTools CHANNEL IS INERT: a bare `Write` entry in Options.disallowedTools did not " +
          "deny an in-owned-path Write, so every disallowedTools form probe below is vacuous.",
      ).toBe(true);
    } finally {
      await scratch.cleanup();
    }
  });

  for (const { form, describeIt, buildRule } of DENY_FORMS) {
    it(`DENY probe (disallowedTools channel): ${describeIt}`, async () => {
      const scratch = await createLiveScratch({ seedOwnedRelPath: "owned" });
      try {
        const rule = buildRule(scratch.worktreePath);
        const outcome = await probeDenyAnchorForm(scratch, rule, "disallowed-tools");
        recordDenyAnchorOutcome(`dt-${form}`, rule, outcome, "disallowed-tools");

        expect(outcome.insideAttempted, "the in-owned-path Write was never attempted").toBe(true);
        expect(outcome.outsideAttempted, "the out-of-owned-path Write was never attempted").toBe(
          true,
        );
        expect(
          outcome.outsideAllowed,
          "CONTROL FAILED: the out-of-owned-path Write did not succeed, so Write was not broadly " +
            "enabled and any inside denial cannot be attributed to the deny rule's anchor",
        ).toBe(true);
        // `insideDenied` is the determination — recorded, not asserted.
      } finally {
        await scratch.cleanup();
      }
    });
  }
});
