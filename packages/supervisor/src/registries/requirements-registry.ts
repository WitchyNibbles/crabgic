/**
 * Requirements registry — roadmap/24.
 *
 * `IntentContract` carries only `requirementIds` (02's hard convention:
 * cross-reference, never an embedded record), so before this the
 * `Requirement` records themselves were resolvable from nowhere. They were
 * built once by `../intake/contract-builder.ts` and then dropped: no
 * registry held them, and the only durable copy was an incidental blob
 * inside the intake idempotency journal entry.
 *
 * That is why `design-addresses-every-acceptance-criterion` is documented as
 * "judged until a requirements source is wired in"
 * (`@crabgic/contracts`' `design-record.ts`) and why nothing could verify a
 * completion against the criteria it was supposed to meet. Sealing criteria
 * is meaningless if the sealed record cannot be read back and compared.
 *
 * Identical shape to `./intent-contracts-registry.ts` and for the identical
 * reason it states — the composition roots wrap it in `./file-registry.ts`
 * so it survives the process boundary between the `run` that produced the
 * intake and the daemon that drives it.
 */
import { type Requirement } from "@crabgic/contracts";
import { createInMemoryRegistry, type Registry } from "./registry.js";

export function createRequirementsRegistry(): Registry<Requirement> {
  return createInMemoryRegistry<Requirement>();
}

/**
 * Resolves the records for a contract's declared requirement ids, dropping
 * ids with no record.
 *
 * Dropping is correct for the APPROVAL FUNNEL and only there: the funnel
 * (`../intake/readiness-gate.ts`) compares what it was given against the ids
 * the contract declares and throws `UnsealableRequirementError` if any are
 * missing. Refusing in this resolver instead would scatter the same check
 * across every approval path — one shared helper so its three call sites
 * (`standing-approval.ts`, `complete-envelope-approval.ts`,
 * `build-tool-registry.ts`) cannot drift, one place that refuses.
 *
 * AMENDED 2026-08-04. The COMPLETION funnel has no such backstop, and using
 * this variant there was half of the defect
 * `24-daemon-requirements-registry-unwired.md`: the daemon's registry is
 * file-backed and ENOENT-tolerant, `@crabgic/scheduler`'s executor accepts an
 * empty presented set by design (a chore unit legitimately owns none), and so
 * a deleted or never-written `requirements.json` degraded a declared
 * acceptance bar back to "no bar" with nothing anywhere objecting. The daemon
 * uses `resolveRequirementsStrict` below.
 */
export function resolveRequirements(
  registry: Pick<Registry<Requirement>, "get">,
  requirementIds: readonly string[],
): readonly Requirement[] {
  return requirementIds
    .map((id) => registry.get(id))
    .filter((requirement): requirement is Requirement => requirement !== undefined);
}

/** Thrown by `resolveRequirementsStrict` when a declared requirement id resolves to no record. Carries the ids so a refusal can NAME what is missing rather than say "something". */
export class UnresolvedRequirementError extends Error {
  readonly missingRequirementIds: readonly string[];
  readonly subjectId: string | undefined;

  constructor(missingRequirementIds: readonly string[], subjectId?: string) {
    const where = subjectId === undefined ? "" : ` declared by "${subjectId}"`;
    super(
      `requirements ${missingRequirementIds.map((id) => `"${id}"`).join(", ")}${where} ` +
        `resolve to no record; refusing to judge a completion against an acceptance bar that is not there`,
    );
    this.name = "UnresolvedRequirementError";
    this.missingRequirementIds = [...missingRequirementIds];
    this.subjectId = subjectId;
  }
}

/**
 * Resolves declared requirement ids, REFUSING rather than dropping when any of
 * them has no record.
 *
 * The completion-funnel variant of `resolveRequirements`. Fail-closed by
 * construction: "this unit declared an acceptance bar and the bar cannot be
 * found" is indistinguishable, downstream, from "this unit declared no bar",
 * and the second is accepted. Every path that judges a COMPLETION must use
 * this one; the approval funnel keeps the dropping variant, which its own
 * readiness gate already backstops.
 *
 * An empty `requirementIds` still resolves to `[]` without throwing — that is
 * the chore unit the executor documents, not a missing record.
 */
export function resolveRequirementsStrict(
  registry: Pick<Registry<Requirement>, "get">,
  requirementIds: readonly string[],
  subjectId?: string,
): readonly Requirement[] {
  const resolved: Requirement[] = [];
  const missing: string[] = [];
  for (const id of requirementIds) {
    const requirement = registry.get(id);
    if (requirement === undefined) missing.push(id);
    else resolved.push(requirement);
  }
  if (missing.length > 0) throw new UnresolvedRequirementError(missing, subjectId);
  return resolved;
}
