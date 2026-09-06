/**
 * Loads a project's `PresentationPolicy` override — `docs/presentation-policy.md`.
 *
 * WHY THIS EXISTS. `PresentationPolicySchema` shipped with the module and
 * nothing ever loaded it: every consumer read `DEFAULT_PRESENTATION_POLICY`
 * directly. It was a "policy" with no configuration path, which mattered most
 * for the one consumer that BLOCKS — `hooks/stop-report-format-gate.mjs` went
 * into other people's repositories with no way to tune its thresholds and no
 * way to turn it off. A blocking hook without an off switch is a defect
 * regardless of how good its rules are.
 *
 * FALLS BACK TO THE DEFAULT ON EVERY FAILURE, and never throws. A malformed
 * config must degrade the presentation, not break the command — the same ruling
 * `resolvePresentationProfile` already applies to an unrecognised
 * `CRABGIC_PRESENTATION` value. The `problems` it returns exist so
 * `crabgic doctor` can tell an operator their file was ignored; silently
 * discarding an edit someone made deliberately is the worse failure.
 *
 * PARTIAL OVERRIDES are merged over the defaults per member, so a project that
 * only wants `formatGate.mode` does not have to restate `enabled` and thereby
 * freeze it against future change.
 *
 * THE LIMITS ARE NOT OVERRIDABLE, and were removed from the schema below on
 * 2026-09-06 rather than left accepted-and-inert. They were merged here and
 * reached nothing: `renderHeading`, `renderHumanReport` and
 * `renderMarkdownReport` each read the module-scope
 * `DEFAULT_PRESENTATION_POLICY.limits`, and not one of `renderHumanReport`,
 * `renderMarkdownReport`, `renderItemListReport` or `renderResultLine` takes a
 * policy. A project that narrowed `bulletMaxColumns` therefore got
 * `source: "file"`, `doctor` reporting the file "applied", and byte-identical
 * output. Making them reach a renderer means threading a policy through some
 * thirty call sites across `packages/cli`, `packages/detect` and here; nothing
 * has asked for it, and both changelogs advertise this file as the format
 * gate's two switches and nothing else. Rejecting the member by name is what
 * turns a silent no-op into the `doctor` warning `problems` exists to produce.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_PRESENTATION_POLICY,
  PresentationPolicySchema,
  type PresentationPolicy,
} from "./presentation-policy.js";

/** Project-relative location of the override. */
export const PRESENTATION_CONFIG_RELPATH = join(".crabgic", "presentation.json");

/**
 * The overridable surface. Deliberately NOT the whole policy: the glyph
 * vocabulary and the colour table are closed by design — "a glyph is a
 * navigation aid only if the same shape always means the same thing" — so
 * letting a project redefine them would remove the property they exist for.
 * The gate's own controls are what an operator has a legitimate reason to
 * change AND what a consumer actually honours: `readGateConfig` in
 * `packages/plugin/hooks/stop-report-format-gate.mjs` reads exactly these two
 * switches. Every other member, `limits` included, is rejected — see the
 * header for the measurement behind that.
 */
const PresentationOverrideSchema = z
  .object({
    formatGate: z
      .object({
        enabled: z.boolean().optional(),
        mode: z.enum(["advisory", "blocking"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface PresentationPolicyLoad {
  readonly policy: PresentationPolicy;
  /** `default` — no file; `file` — loaded and applied; `invalid` — found and rejected. */
  readonly source: "default" | "file" | "invalid";
  /** Human-readable reasons the file was rejected. Empty unless `source` is `invalid`. */
  readonly problems: readonly string[];
}

export function loadPresentationPolicy(projectRoot: string): PresentationPolicyLoad {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, PRESENTATION_CONFIG_RELPATH), "utf8");
  } catch {
    // Absent is the overwhelmingly common case and is not a problem to report.
    return { policy: DEFAULT_PRESENTATION_POLICY, source: "default", problems: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      policy: DEFAULT_PRESENTATION_POLICY,
      source: "invalid",
      problems: [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const result = PresentationOverrideSchema.safeParse(parsed);
  if (!result.success) {
    return {
      policy: DEFAULT_PRESENTATION_POLICY,
      source: "invalid",
      problems: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }

  // The MERGED whole is re-validated through the policy schema, not merely
  // assembled. Two things fall out of that, both wanted: the result carries the
  // exact `PresentationPolicy` type rather than one widened by spreading a
  // partial, and a combination that is individually valid but jointly not is
  // still caught here rather than reaching a renderer.
  const merged = PresentationPolicySchema.safeParse({
    ...DEFAULT_PRESENTATION_POLICY,
    formatGate: {
      ...DEFAULT_PRESENTATION_POLICY.formatGate,
      ...definedOnly(result.data.formatGate),
    },
  });
  if (!merged.success) {
    return {
      policy: DEFAULT_PRESENTATION_POLICY,
      source: "invalid",
      problems: merged.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }

  return { policy: merged.data, source: "file", problems: [] };
}

/**
 * Drops members whose value is `undefined`.
 *
 * A partial override's members are `T | undefined`, and spreading that over the
 * defaults would overwrite a default WITH `undefined` — the opposite of
 * "unnamed members keep their default", and a type error besides. Filtering
 * first makes the spread a genuine `Partial<T>` over `T`, which is `T`.
 */
function definedOnly<T extends object>(source: T | undefined): Partial<T> {
  if (source === undefined) return {};
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
