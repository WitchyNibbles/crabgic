import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildAuthorizationEnvelope } from "@eo/testkit";
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
          const envelopeSet = new Set(env.ownedPaths);
          const requestIsSubset = requestedPaths.every((p) => envelopeSet.has(p));

          const attempt = (): ReturnType<typeof buildTaskPacket> =>
            buildTaskPacket({
              id: "11111111-1111-4111-8111-111111111111",
              workUnitId: "22222222-2222-4222-8222-222222222222",
              requirementIds: [],
              objective: "Implement the thing.",
              baseObjectId: BASE_OBJECT_ID,
              ownedPaths: requestedPaths,
              resourceLimits: { maxTurns: 10 },
              resultSchema: {},
              envelope: env,
            });

          if (requestIsSubset) {
            const { packet } = attempt();
            // The built packet's ownedPaths is provably ⊆ the envelope's.
            expect(packet.ownedPaths.every((p) => envelopeSet.has(p))).toBe(true);
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
});
