import { closeSync, constants, ftruncateSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OwnerDesignVerdictSchema, type OwnerDesignVerdict } from "@crabgic/contracts";
import {
  CRABGIC_DIR_NAME,
  ensureOwnedDir,
  openOwnedFile,
  resolveXdgStateHome,
  type XdgEnv,
} from "@crabgic/journal";

/**
 * The owner's design verdicts — the design gate's only key.
 * Owner ruling R2 (2026-08-15); roadmap/25 work item 5.
 *
 * WHY XDG STATE AND NOT THE JOURNAL OR THE REPO. Same reasoning the
 * `EnvelopePolicy` and the finding store already settled: `JournalEntryType` is
 * closed at thirteen members (ledger Gap 5) and a verdict is not an
 * `EvidenceRecord` — its `objectId` is a Git object id and its `command` and
 * `toolchainFingerprint` are fields an owner's answer has no honest value for.
 * Not the repository either: a design approval is not something to commit, and a
 * file in the tree is a file a worker's worktree could contain.
 *
 * ⚠️ **WHAT MAKES THE GATE A GATE.** Nothing session-reachable may WRITE this.
 * The gateway MCP surface reads it (`ownerDesignVerdict` on the review handler's
 * deps) and has no writing tool; `recordDesignVerdict` is reached only from the
 * CLI, which is the owner typing on their own terminal. That is the same
 * division ledger Gap 18 draws around the `EnvelopePolicy`: if a tool the model
 * can call could record an approval, the model could approve its own design and
 * the gate would be a checkpoint.
 *
 * The path gets `ensureOwnedDir` / `openOwnedFile` like the policy and the
 * signing key, so a symlinked component, a hardlink, a FIFO and a foreign owner
 * are all refused — hardening earned by roast rounds 30-32.
 */

/** Pinned file name under the project's XDG state root. */
export const DESIGN_VERDICTS_FILE_NAME = "design-verdicts.json";

export function resolveDesignVerdictStorePath(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgStateHome(env), CRABGIC_DIR_NAME, projectHash, DESIGN_VERDICTS_FILE_NAME);
}

/**
 * Every verdict on record, or `[]`.
 *
 * Reads as EMPTY for every failure — absent, unparseable, not ours — and an
 * invalid entry is dropped individually rather than poisoning the file. The
 * fail-safe direction is unambiguous here in a way it is not for findings: an
 * unreadable verdict store means the gate refuses, which is the correct answer
 * when nobody can tell whether the owner approved anything.
 */
export async function loadDesignVerdicts(path: string): Promise<readonly OwnerDesignVerdict[]> {
  await Promise.resolve();
  const opened = openOwnedFile(path, constants.O_RDONLY, { requirePrivateMode: true });
  if (opened.refused !== undefined) return [];
  const fd = opened.fd as number;
  let raw: string;
  try {
    raw = readFileSync(fd, "utf8");
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const verdicts: OwnerDesignVerdict[] = [];
  for (const entry of parsed) {
    const result = OwnerDesignVerdictSchema.safeParse(entry);
    if (result.success) verdicts.push(result.data);
  }
  return verdicts;
}

/**
 * The verdict in force for a change set — the LATEST one recorded.
 *
 * Latest-wins is what makes a re-approval after a design edit meaningful, and it
 * is the same rule phase 24's criteria seal uses for the same reason: an earlier
 * approval must not be able to satisfy a gate the owner has since answered
 * differently. Order is file order, which is append order.
 */
export function verdictInForce(
  verdicts: readonly OwnerDesignVerdict[],
  changeSetId: string,
): OwnerDesignVerdict | undefined {
  let found: OwnerDesignVerdict | undefined;
  for (const verdict of verdicts) {
    if (verdict.changeSetId === changeSetId) found = verdict;
  }
  return found;
}

/**
 * Appends a verdict. **CLI-only — never reachable from a session.**
 *
 * Appends rather than replaces, so the record of what the owner said and when
 * survives a later answer. A rejection followed by an approval is the loop in
 * steps 6-7 working, and flattening it would erase the evidence that the design
 * changed because the owner asked it to.
 *
 * Throws rather than degrading: a silent no-op here would leave an owner
 * believing they had approved a design that the gate goes on refusing, and the
 * failure would look like the gate being broken rather than the write.
 */
export async function recordDesignVerdict(
  path: string,
  verdict: OwnerDesignVerdict,
  stateHome: string,
): Promise<void> {
  await Promise.resolve();
  const parsed = OwnerDesignVerdictSchema.safeParse(verdict);
  if (!parsed.success) {
    throw new Error(
      `refusing to record an invalid design verdict: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const dirRefusal = ensureOwnedDir(dirname(path), stateHome);
  if (dirRefusal !== undefined) {
    throw new Error(
      `refusing to write design verdicts: the directory holding ${path} is ${dirRefusal}`,
    );
  }

  const existing = await loadDesignVerdicts(path);
  const next = [...existing, parsed.data];

  // No `O_TRUNC` on open: truncation is a write, and must not happen to
  // anything the ownership checks would go on to refuse.
  const opened = openOwnedFile(path, constants.O_WRONLY | constants.O_CREAT);
  if (opened.refused !== undefined) {
    throw new Error(`refusing to write design verdicts to ${path}: it is ${opened.refused}`);
  }
  const fd = opened.fd as number;
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}
