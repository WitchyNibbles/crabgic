import { z } from "zod";
import type { JournalStore } from "@eo/journal";

/**
 * Flake-quarantine registry — roadmap/14 §In scope, "Flake policy" bullet:
 * "quarantine entries are journaled and expire on a recorded schedule,
 * reverting to blocking." Same "reuse `adjudication_decision`'s generic
 * payload" precedent as `../coverage/ratchet-store.ts` (no dedicated
 * `JournalEntryType` member exists for this — closed at 13, interface-
 * ledger Gap 5).
 */

const QUARANTINE_DECISION = "flake_quarantine_entry";

const QuarantineEntrySchema = z
  .object({
    testIdentifier: z.string().min(1),
    reason: z.string().min(1),
    quarantinedAt: z.string(),
    expiresAt: z.string(),
  })
  .strict();

export interface QuarantineEntry {
  readonly testIdentifier: string;
  readonly reason: string;
  readonly quarantinedAt: string;
  readonly expiresAt: string;
}

function parseEntry(rationale: string): QuarantineEntry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return undefined;
  }
  const result = QuarantineEntrySchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** Journals a new quarantine entry for `testIdentifier`, suppressing blocking until `expiresAt`. */
export async function quarantineTest(
  journal: JournalStore,
  entry: { readonly testIdentifier: string; readonly reason: string; readonly expiresAt: string },
  now: () => Date = () => new Date(),
): Promise<QuarantineEntry> {
  const record: QuarantineEntry = {
    testIdentifier: entry.testIdentifier,
    reason: entry.reason,
    quarantinedAt: now().toISOString(),
    expiresAt: entry.expiresAt,
  };
  await journal.appendEntry({
    type: "adjudication_decision",
    payload: { decision: QUARANTINE_DECISION, rationale: JSON.stringify(record) },
  });
  return record;
}

/**
 * The latest quarantine entry for `testIdentifier` that is STILL ACTIVE as
 * of `nowIso` (i.e. `expiresAt > nowIso`) — `undefined` if never
 * quarantined, or if the most recent entry has expired (reverting to
 * blocking, per roadmap/14's own wording).
 */
export async function getActiveQuarantine(
  journal: JournalStore,
  testIdentifier: string,
  nowIso: string,
): Promise<QuarantineEntry | undefined> {
  let latestSeq = -1;
  let latest: QuarantineEntry | undefined;
  for await (const entry of journal.queryEntries({ type: "adjudication_decision" })) {
    if (entry.type !== "adjudication_decision") continue;
    if (entry.payload.decision !== QUARANTINE_DECISION) continue;
    const parsed = parseEntry(entry.payload.rationale);
    if (parsed === undefined || parsed.testIdentifier !== testIdentifier) continue;
    if (entry.seq <= latestSeq) continue;
    latestSeq = entry.seq;
    latest = parsed;
  }
  if (latest === undefined) return undefined;
  return latest.expiresAt > nowIso ? latest : undefined;
}
