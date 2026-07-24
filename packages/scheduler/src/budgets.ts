/**
 * TaskPacket size-budget enforcement — roadmap/13-scheduler-packets-
 * context.md §In scope, "TaskPacket builder": "size budgets enforced";
 * §Test plan: "TaskPacket size-budget enforcement (a field exceeding
 * budget blocks dispatch with a diff, never silent truncation)"; §Exit
 * criteria: "Packet budget violations block dispatch with an actionable
 * diff — no silent truncation (unit suite)."
 *
 * No byte-budget threshold is pinned by any cited source material (the
 * roadmap only says "size budgets enforced," never naming a number) — the
 * defaults below are this phase's own minimal-sufficient choice, generous
 * enough for a real dispatch prompt while still catching a genuinely
 * runaway field (e.g. an accidentally-embedded full file dump). Every
 * measured field is serialized the same way a worker prompt would render
 * it (`../adapter.ts`-style `buildPromptFromTaskPacket` in 06's own
 * adapter): a bare string field is measured directly; an array field is
 * measured as its bullet-joined rendering; `resultSchema` (a JSON object)
 * is measured via `JSON.stringify`.
 *
 * MINOR-5 fix (adversarial-validation round): every measurement is TRUE
 * UTF-8 byte length (`Buffer.byteLength(rendered, "utf8")`), never a bare
 * JS string `.length` — `.length` counts UTF-16 code units, which
 * silently under-counts any multi-byte character (every non-ASCII
 * codepoint is 2-4 bytes in UTF-8 but only 1-2 `.length` units), letting a
 * field pass a `*Bytes`-named budget while genuinely exceeding it on the
 * wire. See `utf8ByteLength`/`utf8ByteSlice` below.
 */

import type { TaskPacket } from "@eo/contracts";
import { PacketBudgetExceededError, type PacketBudgetViolation } from "./errors.js";

/** One entry per budget-checked `TaskPacket` field, in true UTF-8 BYTES (measured via `Buffer.byteLength(rendered, "utf8")` — never a bare JS string `.length`, which counts UTF-16 code units and silently under-counts any multi-byte character, e.g. non-ASCII text). */
export interface PacketFieldBudgets {
  readonly objective: number;
  readonly nonGoals: number;
  readonly relevantInterfaces: number;
  readonly ownedPaths: number;
  readonly constraints: number;
  readonly gates: number;
  readonly resultSchema: number;
}

/** This phase's own minimal-sufficient defaults — see file-level doc comment. */
export const DEFAULT_PACKET_FIELD_BUDGETS: PacketFieldBudgets = {
  objective: 2_000,
  nonGoals: 4_000,
  relevantInterfaces: 4_000,
  ownedPaths: 4_000,
  constraints: 4_000,
  gates: 1_000,
  resultSchema: 20_000,
};

type BudgetedField = keyof PacketFieldBudgets;

const BUDGETED_FIELDS: readonly BudgetedField[] = [
  "objective",
  "nonGoals",
  "relevantInterfaces",
  "ownedPaths",
  "constraints",
  "gates",
  "resultSchema",
];

/** Renders a `TaskPacket` field to the exact text whose length is budget-checked — see file-level doc comment. */
export function renderBudgetedField(packet: TaskPacket, field: BudgetedField): string {
  if (field === "objective") return packet.objective;
  if (field === "resultSchema") return JSON.stringify(packet.resultSchema);
  return packet[field].join("\n");
}

/**
 * MINOR-5 fix (adversarial-validation round): true UTF-8 byte length via
 * `Buffer.byteLength` — NEVER a bare JS string `.length` (which counts
 * UTF-16 code units, silently under-counting any multi-byte character —
 * e.g. every non-ASCII codepoint, which is 2-4 bytes in UTF-8 but only 1-2
 * `.length` units). A field's actual on-the-wire byte size is what a real
 * budget must gate on.
 */
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Byte-accurate slice of `text` from `startByte` to `endByte` (UTF-8 byte
 * offsets, not JS string-index offsets) — used to build the actionable
 * `diff` at the correct byte boundary. Decoding a slice that happens to
 * land mid-multi-byte-sequence may show a `�` replacement character at
 * the boundary; this is a diagnostic PREVIEW string only (never re-parsed,
 * never round-tripped), so that is an acceptable, documented cosmetic
 * artifact — it never affects `actualBytes`/`overageBytes`, which are
 * always exact.
 */
function utf8ByteSlice(text: string, startByte: number, endByte: number): string {
  return Buffer.from(text, "utf8").subarray(startByte, endByte).toString("utf8");
}

/**
 * Checks every budgeted field of `packet` against `budgets` (defaulting to
 * `DEFAULT_PACKET_FIELD_BUDGETS`). Returns one `PacketBudgetViolation` per
 * over-budget field, in `BUDGETED_FIELDS` order; an empty array means the
 * packet is within budget on every field. Never mutates or truncates
 * `packet` — this function is read-only.
 */
export function checkPacketBudgets(
  packet: TaskPacket,
  budgets: PacketFieldBudgets = DEFAULT_PACKET_FIELD_BUDGETS,
): readonly PacketBudgetViolation[] {
  const violations: PacketBudgetViolation[] = [];
  for (const field of BUDGETED_FIELDS) {
    const rendered = renderBudgetedField(packet, field);
    const limitBytes = budgets[field];
    const actualBytes = utf8ByteLength(rendered);
    if (actualBytes > limitBytes) {
      violations.push({
        field,
        limitBytes,
        actualBytes,
        overageBytes: actualBytes - limitBytes,
        // Actionable diff: the exact excess tail past the budget boundary
        // (byte-accurate, bounded to 200 bytes for a readable error
        // message) — never a silently truncated packet field itself,
        // which is untouched.
        diff: utf8ByteSlice(rendered, limitBytes, limitBytes + 200),
      });
    }
  }
  return violations;
}

/**
 * Throws `PacketBudgetExceededError` (never truncates) if `packet` exceeds
 * `budgets` on any field — the dispatch-blocking gate `../executor.ts`
 * calls immediately before every `spawn`/`resume`.
 */
export function assertPacketWithinBudget(
  packet: TaskPacket,
  budgets: PacketFieldBudgets = DEFAULT_PACKET_FIELD_BUDGETS,
): void {
  const violations = checkPacketBudgets(packet, budgets);
  if (violations.length > 0) {
    throw new PacketBudgetExceededError(violations);
  }
}
