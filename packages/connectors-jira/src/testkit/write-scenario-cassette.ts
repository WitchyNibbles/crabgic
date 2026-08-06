import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HttpTransportRequest, HttpTransportResponse } from "@crabgic/gateway";

/**
 * Write-scenario cassette loader + replay transport — roadmap/18
 * §Exit criteria criterion 1: "Plan's Jira flow passes on fakes +
 * **cassettes**: board → sprint → epic → issue → link → worklog →
 * attachment; ADF/text conversion; transitions; concurrent-edit
 * conflicts", and §Interfaces produced: "Recorded Cloud v3/Agile
 * cassettes."
 *
 * WHY THIS MODULE EXISTS. Before 2026-08-06 the only Cloud cassette in
 * this repository was `./fixtures/read-scenario.cassette.json` — seven
 * GET responses, no create, no link, no worklog write, no attachment, no
 * transition, no non-2xx status — so the criterion's second fixture
 * channel had no bearer at all and no test replayed any mutation from a
 * fixture. `./jira-flow.integration.test.ts` now runs its whole assertion
 * set twice, once against inline literals ("fake") and once against
 * `./fixtures/write-scenario.cassette.json` through this module
 * ("cassette").
 *
 * ⚠️ PROVENANCE, STATED PLAINLY. **The write-scenario cassette is
 * HAND-AUTHORED. It was not captured from a real Jira Cloud instance**,
 * because no licensed Cloud sandbox was available. It is modeled on
 * Jira Cloud's documented REST v3 + Agile v1.0 response shapes, exactly
 * as `./fake-cassette-parity-dc.test.ts:16-22` already discloses for the
 * Data Center cassettes and `e2e/attestation/src/traceabilityEvidence.ts`
 * does for Grafana's. Consequences, so nobody over-reads the fixture:
 *
 *  - It DOES give the criterion's cassette channel a real bearer: the
 *    whole named chain is driven from bytes on disk, and this module
 *    additionally checks every outbound request against the recorded
 *    request line and every served body against its recorded digest —
 *    neither of which the inline-fake arm does at all.
 *  - It does NOT establish that the recorded shapes are what Atlassian
 *    actually returns.
 *  - It is NOT evidence for this phase's fake/cassette PARITY criterion
 *    (exit criterion 9). Parity needs a recording that is INDEPENDENT of
 *    the fake; a second hand-authored fixture is not one. That criterion
 *    stays unticked and owner-gated on a real capture.
 *
 * WHAT THE DIGESTS ARE FOR. Each entry carries `bodyDigest`, the sha-256
 * of its own `response.bodyText`. Semantic assertions (`appliedRevision`
 * is `"PROJ-2"`, the 412 maps to `conflict`, …) parse the JSON and are
 * therefore blind to a byte-level key reorder inside a `bodyText` — that
 * blindness is precisely what made this phase's parity claim vacuous
 * (see `docs/evidence/criteria-closeout/defects/18-cassette-parity-is-a-
 * tautology.md`). The digest is the one check that is not blind to it, so
 * the fixture cannot be edited at the byte level without the edit being
 * deliberate. It pins the FIXTURE's integrity; it makes no claim about
 * the connector.
 */

/** The three scenario sections, one per `describe` block of `./jira-flow.integration.test.ts`. */
export const WRITE_SCENARIO_SECTIONS = ["chain", "transition", "conflict"] as const;
export type WriteScenarioSection = (typeof WRITE_SCENARIO_SECTIONS)[number];

export interface WriteScenarioProvenance {
  /** Always `"hand-authored"` for this fixture — see the module note. A real capture would say `"recorded"`. */
  readonly capture: string;
  /** `null` because nothing was captured. A real capture names the instance/base URL it was taken from. */
  readonly capturedFrom: string | null;
  readonly modeledAfter: string;
  readonly disclosure: string;
  /** The claims this fixture explicitly does NOT support, so a later reader cannot cite it for them. */
  readonly notEvidenceFor: string;
}

export interface WriteScenarioRecordedRequest {
  readonly method: string;
  /** Path (and query, if any) of the recorded request, relative to the instance base URL. */
  readonly path: string;
}

export interface WriteScenarioRecordedResponse {
  readonly status: number;
  readonly bodyText: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface WriteScenarioEntry {
  readonly request: WriteScenarioRecordedRequest;
  readonly response: WriteScenarioRecordedResponse;
  /** `sha256:<hex>` over the UTF-8 bytes of `response.bodyText`. */
  readonly bodyDigest: string;
}

export interface WriteScenarioCassette {
  readonly provenance: WriteScenarioProvenance;
  readonly sections: Readonly<
    Record<WriteScenarioSection, { readonly entries: readonly WriteScenarioEntry[] }>
  >;
}

/** A recorded/actual disagreement observed during replay. Collected rather than thrown so a test can assert on the whole list. */
export interface ReplayViolation {
  readonly index: number;
  readonly kind: "method" | "path" | "body-digest" | "script-exhausted";
  readonly expected: string;
  readonly actual: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "fixtures", "write-scenario.cassette.json");

/** sha-256 of `bodyText`'s UTF-8 bytes, in this fixture's `sha256:<hex>` notation. */
export function recomputeBodyDigest(bodyText: string): string {
  return `sha256:${createHash("sha256").update(bodyText, "utf8").digest("hex")}`;
}

/** Loads the committed write-scenario cassette. Throws if the fixture is absent or is not a cassette. */
export function loadWriteScenarioCassette(): WriteScenarioCassette {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<WriteScenarioCassette>;
  if (parsed.provenance === undefined || parsed.sections === undefined) {
    throw new Error(
      `write-scenario cassette at ${FIXTURE_PATH} is missing "provenance"/"sections" — not a write-scenario cassette`,
    );
  }
  return parsed as WriteScenarioCassette;
}

/**
 * Builds a `sendRequest`-compatible replay transport over one section of
 * the cassette. Plugs into the exact same `GatewayHttpClient` injection
 * point 16's `createFakeProviderTransport` uses, so the cassette arm runs
 * the connector's REAL transport stack (SSRF preflight, retry ladder,
 * budgets, write serialization) — never a bespoke shortcut.
 *
 * Unlike the positional fake, this replays the RECORDED REQUEST too: each
 * call's method and path are compared against the entry's recorded request
 * line, and each served body against its recorded digest. Disagreements
 * are collected in `violations` (not thrown), so a caller asserts
 * `expect(violations).toEqual([])` and gets the whole list on failure
 * rather than only the first — and so a request-shape drift is reported as
 * itself rather than as a downstream parse error.
 */
export function createCassetteReplayTransport(
  cassette: WriteScenarioCassette,
  section: WriteScenarioSection,
): {
  readonly send: (request: HttpTransportRequest) => Promise<HttpTransportResponse>;
  readonly violations: readonly ReplayViolation[];
  /** How many recorded entries were actually served. Named so a test can prove the replay was not short-circuited. */
  readonly entriesServed: number;
} {
  const entries = cassette.sections[section]?.entries;
  if (entries === undefined) {
    throw new Error(
      `write-scenario cassette has no section "${section}" (sections: ${Object.keys(cassette.sections).join(", ")})`,
    );
  }
  const violations: ReplayViolation[] = [];
  let index = 0;

  const state = { entriesServed: 0 };

  const send = async (request: HttpTransportRequest): Promise<HttpTransportResponse> => {
    const at = index;
    index += 1;
    const entry = entries[at];
    if (entry === undefined) {
      violations.push({
        index: at,
        kind: "script-exhausted",
        expected: `${entries.length} recorded call(s)`,
        actual: `call #${at + 1}: ${request.method} ${new URL(request.url).pathname}`,
      });
      throw new Error(
        `cassette replay: section "${section}" recorded ${entries.length} call(s); the connector made at least ${at + 1}`,
      );
    }
    const actualPath = new URL(request.url).pathname + new URL(request.url).search;
    if (request.method !== entry.request.method) {
      violations.push({
        index: at,
        kind: "method",
        expected: entry.request.method,
        actual: request.method,
      });
    }
    if (actualPath !== entry.request.path) {
      violations.push({
        index: at,
        kind: "path",
        expected: entry.request.path,
        actual: actualPath,
      });
    }
    const servedDigest = recomputeBodyDigest(entry.response.bodyText);
    if (servedDigest !== entry.bodyDigest) {
      violations.push({
        index: at,
        kind: "body-digest",
        expected: entry.bodyDigest,
        actual: servedDigest,
      });
    }
    state.entriesServed += 1;
    return {
      status: entry.response.status,
      headers: entry.response.headers ?? {},
      bodyText: entry.response.bodyText,
    };
  };

  return {
    send,
    violations,
    get entriesServed(): number {
      return state.entriesServed;
    },
  };
}
