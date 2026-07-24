/**
 * Content-derived stable IDs — roadmap/11-intake-contract-approval.md §In
 * scope, "Contract assembly" bullet: "stable requirement IDs"; §Test plan,
 * Unit: "`Requirement` ID uniqueness/stability across re-inspection." A
 * `Requirement`'s id is derived from its own stable content (section +
 * title), NOT a call-order counter, so re-inspecting an unchanged repo (a
 * fresh builder invocation over the identical drafted requirement set)
 * assigns the SAME id to the SAME requirement every time — a random/
 * counter-based id would instead mint a new id per call and defeat both
 * the "stable across re-inspection" test-plan item and `./intake-
 * pipeline.ts`'s own content-hash idempotency check (a requirement's id is
 * itself part of that content hash).
 */
import { createHash } from "node:crypto";
import { IdSchema, type Id } from "@eo/contracts";

/** Deterministically derives an RFC-4122-shaped (version-4, variant-1) UUID from `seed` — the same seed always produces the same id, on any run, on any machine. */
export function deriveStableId(seed: string): Id {
  const digest = createHash("sha256").update(seed).digest("hex");
  const uuid =
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-` +
    `4${digest.slice(13, 16)}-` +
    `${"89ab"[parseInt(digest[16]!, 16) % 4]}${digest.slice(17, 20)}-` +
    `${digest.slice(20, 32)}`;
  return IdSchema.parse(uuid);
}
