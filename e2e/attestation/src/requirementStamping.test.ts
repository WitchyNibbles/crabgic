import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readReleaseRequirements, requirementIdForGateTag } from "./releaseRequirements.js";

/**
 * PRODUCER/CONSUMER BINDING FOR `EvidenceRecord.requirementId`.
 *
 * `buildTraceabilityView` (`@crabgic/gates`) matches evidence to a requirement on
 * `requirementId` ALONE. A record that is genuine, correctly tagged and
 * journaled at the right object ID still contributes NOTHING to traceability
 * if that one field is absent — which is exactly the state this repository
 * was in: of the eight harnesses feeding the shared release journal, only
 * `e2e/attestation` stamped it. `e2e/matrix/orchestration` and
 * `e2e/matrix/connector` accepted an optional `requirementId` that no caller
 * ever passed; `e2e/matrix/git`, `e2e/matrix/installation`, `e2e/live` and
 * `e2e/release` had no such field at all. Measured against the real corpus,
 * that put 7 of 16 requirements in reach and left the rest structurally
 * unlinkable.
 *
 * WHY THIS TEST READS SOURCE TEXT. Each `e2e/*` harness is a self-contained
 * TypeScript project (its own `tsconfig.json`, `rootDir: "."`), so this
 * project cannot import a sibling harness's module to assert against its
 * exported constant. The established precedent in this phase is to read the
 * REAL sibling artifact as text and bind the two ends together —
 * `e2e/release/src/releaseWorkflowWiring.test.ts` does precisely this
 * against `.github/workflows/release-e2e.yml`. The alternative, duplicating
 * the id derivation into six harnesses, is the drift this test exists to
 * prevent.
 *
 * THE IDS ARE NOT ARBITRARY. `releaseRequirements.ts` derives a UUIDv5 from
 * each roadmap/23 exit-criterion's own text, so the literal each harness
 * declares must equal `requirementIdForGateTag(corpus, tag)` for the tag it
 * emits under. If a criterion is reworded, its id changes and this test goes
 * red rather than the gate silently reporting fewer linked requirements.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every harness that journals `release-gate:*` evidence, and the emitter module that does it. */
const EMITTERS: readonly { readonly harness: string; readonly source: string }[] = [
  { harness: "e2e/matrix/git", source: "e2e/matrix/git/src/evidence.ts" },
  { harness: "e2e/matrix/installation", source: "e2e/matrix/installation/src/evidence.ts" },
  { harness: "e2e/matrix/orchestration", source: "e2e/matrix/orchestration/src/evidence.ts" },
  { harness: "e2e/matrix/connector", source: "e2e/matrix/connector/src/support/evidence.ts" },
  { harness: "e2e/live", source: "e2e/live/src/evidence.ts" },
  { harness: "e2e/release", source: "e2e/release/src/evidence.ts" },
];

/**
 * The map literal each emitter declares, as `tag -> uuid` pairs.
 *
 * Deliberately narrow: it matches an entry of the shape
 * `"release-gate:<slug>": "<uuid>"`, which is the one form
 * `REQUIREMENT_ID_BY_GATE_TAG` is written in. A harness that stops declaring
 * the map yields zero pairs and fails the "declares one" assertion below,
 * rather than passing vacuously.
 */
function parseRequirementIdMap(source: string): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  const entry =
    /"(release-gate:[a-z0-9-]+)":\s*\n?\s*"([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})"/g;
  for (const match of source.matchAll(entry)) {
    const [, tag, id] = match;
    if (tag !== undefined && id !== undefined) pairs.set(tag, id);
  }
  return pairs;
}

const requirements = readReleaseRequirements(REPO_ROOT);

describe("every release harness stamps requirementId", () => {
  it("finds a non-empty requirement corpus to bind against", () => {
    expect(requirements.length).toBeGreaterThan(0);
  });

  for (const emitter of EMITTERS) {
    describe(emitter.harness, () => {
      const source = readFileSync(join(REPO_ROOT, emitter.source), "utf-8");
      const declared = parseRequirementIdMap(source);

      it("declares a requirement id for at least one gate tag", () => {
        expect(declared.size).toBeGreaterThan(0);
      });

      it("declares ids that match the corpus id for the same gate tag", () => {
        for (const [tag, declaredId] of declared) {
          expect(
            { tag, id: declaredId },
            `${emitter.source} stamps ${tag} with an id the corpus does not derive for it`,
          ).toEqual({ tag, id: requirementIdForGateTag(requirements, tag) });
        }
      });

      it("stamps requirementId onto the record it journals", () => {
        expect(source).toMatch(/requirementId/);
      });
    });
  }
});

describe("the corpus covers every gate tag the harnesses emit", () => {
  it("leaves no emitted tag without a requirement to link it to", () => {
    const orphans: string[] = [];
    for (const emitter of EMITTERS) {
      const source = readFileSync(join(REPO_ROOT, emitter.source), "utf-8");
      for (const tag of parseRequirementIdMap(source).keys()) {
        if (requirementIdForGateTag(requirements, tag) === undefined) {
          orphans.push(`${emitter.harness} emits ${tag}, which no requirement claims`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });
});
