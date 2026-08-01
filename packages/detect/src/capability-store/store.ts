/**
 * `createCapabilityStore` — roadmap/12 §In scope, "Content-addressed
 * capability store" bullet: holds "digest-pinned capability entries plus
 * their audit-report artifacts." One directory per store key (`./key.ts`)
 * under `rootDir` (`./layout.ts`'s `resolveCapabilityStoreDir`), containing
 * `report.json` (the `AuditReport`) and, when produced, `manifest-
 * entry.json` (the `CapabilityManifestEntry`). A small `by-name/<name>
 * .json` pointer file per capability NAME tracks the latest key written
 * for that name — `../trust/*` and `./reaudit.ts` both need "what did we
 * last see for this capability?" without scanning every key.
 *
 * **interface-ledger Gap 5, resolution (2026-08-01) — `updateDecision` is
 * journal-first.** This store's artifacts are REWRITABLE: `updateDecision`
 * overwrites `report.json` in place and keeps no history, so before this
 * change the `pending -> approved` flip and `trust revoke`'s flip back
 * left no durable trace anywhere — the only central record any
 * capability-quarantine activity produced was the `approval_token_mint`
 * from a human `trust approve`, which by construction never exists for a
 * REJECTED candidate. Every transition now appends an
 * `adjudication_decision` to the hash-chained journal (04) BEFORE the
 * artifact is rewritten, and a failed append ABORTS the flip. Fail closed:
 * an approval nobody can later prove happened is worse than a refused one.
 * See `./audit-journal.ts` for the record shapes and why the union stays
 * closed at 13.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityDecision, CapabilityManifestEntry } from "@crabgic/contracts";
import {
  CapabilityAuditJournalUnavailableError,
  journalCapabilityDecisionTransition,
  type CapabilityAuditJournalSink,
} from "./audit-journal.js";
import { computeCapabilityStoreKey } from "./key.js";
import type { AuditReport } from "../quarantine/types.js";

export interface CapabilityStoreEntry {
  readonly key: string;
  readonly report: AuditReport;
  readonly manifestEntry?: CapabilityManifestEntry;
}

interface NamePointer {
  readonly key: string;
  readonly digest: string;
  readonly permissionFootprint: readonly string[];
  readonly updatedAt: string;
}

export interface CapabilityStoreOptions {
  /**
   * Where decision transitions are journaled. OPTIONAL on the type so the
   * many read-mostly consumers (`@crabgic/gates`'s security gate and tool
   * resolution, which only `save`/`load`/`list`/`findByDigest`) need no
   * journal at all — but `updateDecision` REJECTS with
   * `CapabilityAuditJournalUnavailableError` when it is absent rather than
   * silently flipping a decision unjournaled (interface-ledger Gap 5).
   */
  readonly journal?: CapabilityAuditJournalSink;
  /** Injectable clock for the transition record's `recordedAt` — defaults to wall time. */
  readonly clock?: () => string;
}

export interface CapabilityStore {
  save(report: AuditReport, manifestEntry?: CapabilityManifestEntry): CapabilityStoreEntry;
  load(key: string): CapabilityStoreEntry | undefined;
  /** Journal-first (Gap 5): appends the transition, then rewrites the artifact. Rejects — leaving the artifact untouched — if the append fails or no journal sink was supplied. */
  updateDecision(key: string, decision: CapabilityDecision): Promise<CapabilityStoreEntry>;
  list(): readonly CapabilityStoreEntry[];
  /** The latest entry previously stored for `name`, or `undefined` if none — `./reaudit.ts`'s own input. */
  findLatestByName(name: string): CapabilityStoreEntry | undefined;
  /** The entry whose `report.digest` equals `digest`, or `undefined` if none — `../trust/trust-revoke.ts`'s own lookup (a `trust revoke <token-id>` call only carries a digest via its approval-ledger record, never a store key directly). */
  findByDigest(digest: string): CapabilityStoreEntry | undefined;
}

function entryDir(rootDir: string, key: string): string {
  return join(rootDir, key);
}

function readEntry(rootDir: string, key: string): CapabilityStoreEntry | undefined {
  const dir = entryDir(rootDir, key);
  const reportPath = join(dir, "report.json");
  if (!existsSync(reportPath)) return undefined;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as AuditReport;
  const manifestEntryPath = join(dir, "manifest-entry.json");
  const manifestEntry = existsSync(manifestEntryPath)
    ? (JSON.parse(readFileSync(manifestEntryPath, "utf8")) as CapabilityManifestEntry)
    : undefined;
  return manifestEntry === undefined ? { key, report } : { key, report, manifestEntry };
}

export function createCapabilityStore(
  rootDir: string,
  options: CapabilityStoreOptions = {},
): CapabilityStore {
  const clock = options.clock ?? (() => new Date().toISOString());
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const byNameDir = join(rootDir, "by-name");
  mkdirSync(byNameDir, { recursive: true, mode: 0o700 });

  return {
    save(report, manifestEntry) {
      const key = computeCapabilityStoreKey(report.digest, report.permissionFootprint);
      const dir = entryDir(rootDir, key);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
      if (manifestEntry !== undefined) {
        writeFileSync(join(dir, "manifest-entry.json"), JSON.stringify(manifestEntry, null, 2), {
          mode: 0o600,
        });
      }

      const pointer: NamePointer = {
        key,
        digest: report.digest,
        permissionFootprint: report.permissionFootprint,
        updatedAt: report.auditedAt,
      };
      writeFileSync(
        join(byNameDir, `${encodeURIComponent(report.candidateName)}.json`),
        JSON.stringify(pointer, null, 2),
        { mode: 0o600 },
      );

      return manifestEntry === undefined ? { key, report } : { key, report, manifestEntry };
    },

    load(key) {
      return readEntry(rootDir, key);
    },

    async updateDecision(key, decision) {
      // Checked FIRST — an unjournalable flip must be refused before it
      // can even be attempted, not after the artifact has been read and
      // the caller has been given reason to think it will succeed.
      if (options.journal === undefined) {
        throw new CapabilityAuditJournalUnavailableError("capability-store.updateDecision");
      }
      const existing = readEntry(rootDir, key);
      if (existing === undefined) {
        throw new Error(`capability-store: no entry found for key "${key}"`);
      }

      // JOURNAL FIRST. A rejection here propagates and no write happens —
      // the artifact keeps its previous decision (Gap 5, fail closed). A
      // no-op transition (`from === to`) is journaled too: the history is
      // append-only and a redundant revoke is still a human action worth
      // a record.
      await journalCapabilityDecisionTransition(options.journal, {
        storeKey: key,
        candidateName: existing.report.candidateName,
        digest: existing.report.digest,
        from: existing.report.decision,
        to: decision,
        recordedAt: clock(),
      });

      const updatedReport: AuditReport = { ...existing.report, decision };
      const dir = entryDir(rootDir, key);
      writeFileSync(join(dir, "report.json"), JSON.stringify(updatedReport, null, 2), {
        mode: 0o600,
      });
      if (existing.manifestEntry !== undefined) {
        const updatedManifestEntry = {
          ...existing.manifestEntry,
          decision,
        } as CapabilityManifestEntry;
        writeFileSync(
          join(dir, "manifest-entry.json"),
          JSON.stringify(updatedManifestEntry, null, 2),
          { mode: 0o600 },
        );
        return { key, report: updatedReport, manifestEntry: updatedManifestEntry };
      }
      return { key, report: updatedReport };
    },

    list() {
      if (!existsSync(rootDir)) return [];
      return readdirSync(rootDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "by-name" && e.name !== "approvals")
        .map((e) => readEntry(rootDir, e.name))
        .filter((e): e is CapabilityStoreEntry => e !== undefined);
    },

    findLatestByName(name) {
      const pointerPath = join(byNameDir, `${encodeURIComponent(name)}.json`);
      if (!existsSync(pointerPath)) return undefined;
      const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as NamePointer;
      return readEntry(rootDir, pointer.key);
    },

    findByDigest(digest) {
      if (!existsSync(rootDir)) return undefined;
      const dirs = readdirSync(rootDir, { withFileTypes: true }).filter(
        (e) => e.isDirectory() && e.name !== "by-name" && e.name !== "approvals",
      );
      for (const dir of dirs) {
        const entry = readEntry(rootDir, dir.name);
        if (entry?.report.digest === digest) return entry;
      }
      return undefined;
    },
  };
}
