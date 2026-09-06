import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildAuthorizationEnvelope } from "@crabgic/testkit";
import { normalizePathPrefix } from "@crabgic/contracts";
import { buildTaskPacket } from "./task-packet-builder.js";
import { PacketEnvelopeViolationError } from "./errors.js";

/**
 * Security property test — roadmap/13 §Test plan, Security: "packet-
 * builder fuzz — a TaskPacket's owned-paths/commands can never be
 * constructed wider than the approved AuthorizationEnvelope it's derived
 * from (property test over random envelope/packet pairs)."
 */

const SEGMENT_POOL = ["packages", "example", "src", "lib", "app", "a", "b", "nested"] as const;

function pathArb(): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...SEGMENT_POOL), { minLength: 1, maxLength: 3 })
    .map((segments) => segments.join("/"));
}

function commandArb(): fc.Arbitrary<string> {
  return fc.constantFrom("npm run build", "npm run test", "git status", "git diff", "npm ci");
}

const BASE_OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

describe("buildTaskPacket — property: packet is never constructed wider than its envelope", () => {
  it("ownedPaths ⊆ envelope.ownedPaths always holds, or a PacketEnvelopeViolationError is thrown", () => {
    fc.assert(
      fc.property(
        fc.array(pathArb(), { minLength: 0, maxLength: 5 }),
        fc.array(pathArb(), { minLength: 0, maxLength: 5 }),
        (envelopePaths, requestedPaths) => {
          const env = buildAuthorizationEnvelope({ ownedPaths: [...new Set(envelopePaths)] });
          // The oracle is written out HERE, independently, and never by
          // calling the predicate under test. Until 2026-09-05 it read
          // `new Set(env.ownedPaths).has(p)` — byte-identical to the
          // implementation's own line — so it asserted whatever the builder
          // did, and pinned the defect that killed run `aff03e3a` as correct
          // behaviour (counterexample: envelope `["lib"]`, requested
          // `["lib/packages"]`). A tautological oracle is the vacuity pattern
          // `docs/verification-playbook.md` names; this one is a statement.
          //
          // Plain string comparison is SOUND here only because `pathArb()`
          // draws from a fixed pool of bare segments: no `.`, `..`, `~`,
          // leading `/`, glob metacharacter or empty segment is generable, so
          // every path it produces is already its own normalized form. The
          // hostile spellings normalization exists for are fuzzed by the
          // fail-closed property below instead.
          const requestIsSubset = requestedPaths.every((p) =>
            env.ownedPaths.some((granted) => p === granted || p.startsWith(`${granted}/`)),
          );

          const attempt = (): ReturnType<typeof buildTaskPacket> =>
            buildTaskPacket({
              id: "11111111-1111-4111-8111-111111111111",
              workUnitId: "22222222-2222-4222-8222-222222222222",
              requirementIds: [],
              spec: {
                schemaVersion: 1,
                id: "aaaaaaaa-0000-4000-8000-00000000000f",
                taskId: "fixture-task",
                requirements: [
                  {
                    requirementId: "fixture-requirement",
                    acceptanceCriteria: ["Objective observably met."],
                  },
                ],
                doneCriteria: ["A named test demonstrates it."],
                testsFirst: true,
                permittedInterfaces: [],
              },
              objective: "Implement the thing.",
              baseObjectId: BASE_OBJECT_ID,
              ownedPaths: requestedPaths,
              resourceLimits: { maxTurns: 10 },
              resultSchema: {},
              envelope: env,
            });

          if (requestIsSubset) {
            const { packet } = attempt();
            // The built packet's ownedPaths are provably at or below the
            // envelope's — never merely members of it.
            expect(
              packet.ownedPaths.every((p) =>
                env.ownedPaths.some((granted) => p === granted || p.startsWith(`${granted}/`)),
              ),
            ).toBe(true);
          } else {
            expect(attempt).toThrow(PacketEnvelopeViolationError);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("allowedCommands ⊆ envelope.commands always holds, or a PacketEnvelopeViolationError is thrown", () => {
    fc.assert(
      fc.property(
        fc.array(commandArb(), { minLength: 0, maxLength: 4 }),
        fc.array(commandArb(), { minLength: 0, maxLength: 4 }),
        (envelopeCommands, requestedCommands) => {
          const env = buildAuthorizationEnvelope({ commands: [...new Set(envelopeCommands)] });
          const envelopeSet = new Set(env.commands);
          const requestIsSubset = requestedCommands.every((c) => envelopeSet.has(c));

          const attempt = (): ReturnType<typeof buildTaskPacket> =>
            buildTaskPacket({
              id: "11111111-1111-4111-8111-111111111111",
              workUnitId: "22222222-2222-4222-8222-222222222222",
              requirementIds: [],
              spec: {
                schemaVersion: 1,
                id: "aaaaaaaa-0000-4000-8000-00000000000f",
                taskId: "fixture-task",
                requirements: [
                  {
                    requirementId: "fixture-requirement",
                    acceptanceCriteria: ["Objective observably met."],
                  },
                ],
                doneCriteria: ["A named test demonstrates it."],
                testsFirst: true,
                permittedInterfaces: [],
              },
              objective: "Implement the thing.",
              baseObjectId: BASE_OBJECT_ID,
              ownedPaths: [],
              allowedCommands: requestedCommands,
              resourceLimits: { maxTurns: 10 },
              resultSchema: {},
              envelope: env,
            });

          if (requestIsSubset) {
            const { packet } = attempt();
            const usedCommands = new Set(
              packet.constraints.map((c) => c.replace("Allowed command: ", "")),
            );
            expect([...usedCommands].every((c) => envelopeSet.has(c))).toBe(true);
          } else {
            expect(attempt).toThrow(PacketEnvelopeViolationError);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  /**
   * FAIL CLOSED on a spelling that cannot name a worktree path.
   *
   * The relaxation from membership to containment is only safe if the
   * comparison still refuses everything `normalizePathPrefix` refuses. This
   * fuzzes the escapes directly — `..` traversal, absolute, `~`-anchored,
   * glob — under an envelope that grants the very parent the escape is
   * spelled from, which is the strongest form of the trap: a raw
   * `startsWith` test, or a normalizer that resolved `..`, would admit them.
   *
   * The generated path is asserted UNNORMALIZABLE first, so a future change
   * to the pool cannot quietly turn this into a test of nothing.
   */
  it("refuses an owned path that cannot be normalized, even under a granted parent", () => {
    const escapeArb = fc.oneof(
      fc.constantFrom("..", "../..", "../../etc").map((up) => `packages/example/${up}/secrets`),
      fc.constantFrom("/etc/shadow", "/packages/example/src"),
      fc.constantFrom("~", "~/.ssh/id_rsa", "~root/.ssh"),
      fc.constantFrom("*", "**", "?", "[a-z]", "{a,b}").map((glob) => `packages/example/${glob}`),
    );

    fc.assert(
      fc.property(escapeArb, (escape) => {
        expect(normalizePathPrefix(escape)).toBeUndefined();

        const attempt = (): ReturnType<typeof buildTaskPacket> =>
          buildTaskPacket({
            id: "11111111-1111-4111-8111-111111111111",
            workUnitId: "22222222-2222-4222-8222-222222222222",
            requirementIds: [],
            spec: {
              schemaVersion: 1,
              id: "aaaaaaaa-0000-4000-8000-00000000000f",
              taskId: "fixture-task",
              requirements: [
                {
                  requirementId: "fixture-requirement",
                  acceptanceCriteria: ["Objective observably met."],
                },
              ],
              doneCriteria: ["A named test demonstrates it."],
              testsFirst: true,
              permittedInterfaces: [],
            },
            objective: "Implement the thing.",
            baseObjectId: BASE_OBJECT_ID,
            ownedPaths: [escape],
            resourceLimits: { maxTurns: 10 },
            resultSchema: {},
            // Grants the parent the escape is spelled from, and the root.
            envelope: buildAuthorizationEnvelope({
              ownedPaths: ["packages/example", "packages", "etc"],
            }),
          });

        expect(attempt).toThrow(PacketEnvelopeViolationError);
      }),
      { numRuns: 500 },
    );
  });
});
