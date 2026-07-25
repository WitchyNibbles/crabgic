import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUPPORT_WINDOW_TARGETS,
  VendorSupportPolicySchema,
  buildSupportWindowRecords,
  fetchHttpProbe,
  type BuildSupportWindowRecordsResult,
  type HttpProbe,
  type SupportWindowTargetSpec,
} from "./supportWindows.js";

/**
 * Entry point for the vendor support-window probe — run weekly from
 * `.github/workflows/drift-ci.yml` and on demand via
 * `npm run probe:support-windows`.
 *
 * Mirrors `packages/gates/src/drift/cli.ts`'s split: everything here is
 * dependency-injectable and unit-testable, and the `process.exit`/
 * `import.meta` glue at the bottom is excluded from coverage the same way
 * that file's is.
 *
 * PROPOSE, NEVER APPLY — the same discipline drift-ci already follows. This
 * writes an evidence record describing what the vendors currently say; it
 * never edits a pinned version, a compose recipe, or the compatibility
 * matrix. Acting on a moved window is a human decision.
 */

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `e2e/provisioning/src` -> repo root is 3 levels up. */
export const REPO_ROOT = join(THIS_DIR, "..", "..", "..");

export const VENDOR_SUPPORT_POLICY_PATH = "docs/vendor-support-policy.json";
export const SUPPORT_WINDOW_RECORD_PATH = "docs/evidence/phase-23/vendor-support-windows.json";

export interface RunSupportWindowProbeOptions {
  readonly repoRoot?: string;
  readonly targets?: readonly SupportWindowTargetSpec[];
  readonly http?: HttpProbe;
  /** ISO `YYYY-MM-DD`; defaults to today. Injected so a test run is deterministic. */
  readonly probedOn?: string;
  readonly outFile?: string;
}

export interface RunSupportWindowProbeResult extends BuildSupportWindowRecordsResult {
  readonly outFile: string;
}

export async function runSupportWindowProbe(
  options: RunSupportWindowProbeOptions = {},
): Promise<RunSupportWindowProbeResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const policyRaw = await readFile(join(repoRoot, VENDOR_SUPPORT_POLICY_PATH), "utf-8");
  const policy = VendorSupportPolicySchema.parse(JSON.parse(policyRaw));

  const result = await buildSupportWindowRecords({
    targets: options.targets ?? SUPPORT_WINDOW_TARGETS,
    policy,
    http: options.http ?? fetchHttpProbe,
    probedOn: options.probedOn ?? new Date().toISOString().slice(0, 10),
  });

  const outFile = options.outFile ?? join(repoRoot, SUPPORT_WINDOW_RECORD_PATH);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(result.records, null, 2)}\n`, "utf-8");

  return { ...result, outFile };
}

/* c8 ignore start -- process.exit / import.meta CLI entrypoint glue, not unit-testable logic. */
const isMainModule =
  process.argv[1]?.endsWith("supportWindowsCli.js") === true ||
  process.argv[1]?.endsWith("supportWindowsCli.ts") === true;
if (isMainModule) {
  runSupportWindowProbe()
    .then(({ records, skipped, outFile }) => {
      console.log(`support-window probe: wrote ${outFile} — ${records.length} record(s)`);
      for (const record of records) {
        const window =
          record.lifecycle === "continuous" ? "continuous" : `until ${record.supportEndsOn ?? "?"}`;
        console.log(`  ${record.target}: ${window}, tagPublished=${String(record.tagPublished)}`);
      }
      // Skipped targets are printed, never swallowed: each one becomes a
      // coverage failure at the release gate, and the operator needs to know
      // why before it surfaces there.
      for (const reason of skipped) console.warn(`  SKIPPED ${reason}`);
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("support-window probe: fatal error", error);
      process.exit(1);
    });
}
/* c8 ignore stop */
