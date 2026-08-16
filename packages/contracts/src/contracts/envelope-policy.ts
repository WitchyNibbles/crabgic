import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `EnvelopePolicy` — the standing approval (interface-ledger Gap 18).
 *
 * A human authors this once, at `crabgic install`. Every dispatch tests the
 * compiled `AuthorizationEnvelope` for containment in it: contained means the
 * standing approval already covers this run and no prompt or token is
 * involved; not contained means dispatch is refused before a run exists, so
 * the ChangeSet stays `ready` and fixing the policy is enough to proceed.
 *
 * TWO ROLES, NOT ONE. This is also a **compiler input**, and that is not a
 * convenience — it is what makes standing approval sound at all. Design roast
 * round 1 (`docs/evidence/gap-18/design-roast-round-1.md`, F1) established
 * that `sandbox-profile.ts` deliberately leaves `filesystem.allowWrite` at the
 * whole worktree, delegating owned-path scoping to the permission layer, which
 * sees *tool calls* and cannot by construction see the syscalls of a process
 * it spawned. An allow-listed `npm run test` executing a test file the worker
 * legitimately wrote inside its owned path therefore reaches the whole
 * worktree. A human gate bounds that by someone reading the diff; a standing
 * approval does not. The compiler declined to narrow `allowWrite` for a
 * correct reason — build-output directories are "project-specific and
 * unknowable **here**", its only inputs being one envelope's four fields — and
 * that is precisely what a human writing a policy once *can* state. Hence
 * `allowedWriteScratchPaths` and `allowUnixSockets`.
 *
 * EVERY DIMENSION DEFAULTS TO DENY. Each list defaults to empty rather than
 * being optional-and-absent (F10): a future authority axis added here fails
 * **closed** against every policy already on disk, the way a 12th
 * `HighImpactCapabilityFlag` already does. An absent field must never mean
 * "unconstrained".
 *
 * WHAT THIS SCHEMA DELIBERATELY DOES NOT CARRY. `prohibitedActions`,
 * `dependencies` and `temporaryServices` exist on `AuthorizationEnvelope` and
 * are read by **no** consumer — not the compiler, not a gate, not the gateway
 * (F5, F14). Mirroring them here would let a policy author believe they bound
 * something. They are documented as inert instead, and containment treats
 * `prohibitedActions` as carrying no authority in either direction: the claim
 * that "a prohibition can only narrow" holds only where prohibitions are
 * enforced, and here the field's only reader was the human being removed.
 */

/**
 * The command prefixes a compiled profile can actually grant.
 *
 * Owned here rather than in the compiler for the same reason
 * `GATEWAY_MCP_SERVER_NAME` is (ledger Gap 11): it is a shared constant two
 * packages must agree on byte-for-byte, and 02 owns those. `permission-
 * profile.ts`'s `MANDATORY_BASH_ALLOWLIST` maps each of these to its emitted
 * `Bash(... :*)` rule and **silently discards every other string** in
 * `envelope.commands`. Closing the union here is what stops a policy author
 * writing `npm run lint`, believing it granted, and getting a halt over a
 * string whose presence or absence leaves the compiled profile identical.
 *
 * Note for whoever widens this: the emitted rule is a `:*` PREFIX rule, so
 * granting `npm run test` also grants `npm run test --config <any file>`
 * (F11). Adding a member widens more than it looks like it does.
 */
export const GRANTABLE_COMMAND_PREFIXES = [
  "npm run test",
  "npm run build",
  "git status",
  "git diff",
] as const;

export const GrantableCommandPrefixSchema = z.enum(GRANTABLE_COMMAND_PREFIXES);
export type GrantableCommandPrefix = z.infer<typeof GrantableCommandPrefixSchema>;

/**
 * What each grantable prefix ESTABLISHES when it runs and exits clean — owner
 * ruling R5's vocabulary, and the reason `acceptance-evaluation.ts` can decide
 * "were the acceptance criteria evaluated" without a judgement that drifts.
 *
 *   - `acceptance` — running it exercises the work against its criteria. A
 *     clean exit is evidence the criteria were EVALUATED (not that they are
 *     adequate; see `./acceptance-evaluation.ts` for that bound).
 *   - `integrity` — running it establishes the tree is well-formed. Necessary,
 *     never sufficient: run `bc167a3a` reported `npm run build` clean and
 *     stated in its own result record that the suite never ran, and R5 exists
 *     to refuse exactly that run (`docs/evidence/phase-25/published-unverified.md`).
 *   - `inspection` — running it reads state and asserts nothing. A worker can
 *     invoke it a hundred times having verified nothing at all.
 *
 * A `Record<GrantableCommandPrefix, …>` LITERAL, deliberately, not a filtered
 * array: TypeScript rejects both a missing key and a stray one, so widening
 * `GRANTABLE_COMMAND_PREFIXES` fails `tsc` here until the widener says which
 * class the new member is. That is the same exhaustiveness mechanism
 * `JOURNAL_ENTRY_TYPE_DESCRIPTIONS` uses, and it matters more here: a new
 * prefix silently defaulting to `acceptance` would let a `git log` grant
 * satisfy the publish gate, and one silently defaulting to `inspection` would
 * make a genuine test command unable to.
 */
export const COMMAND_EVIDENCE_CLASSES = ["acceptance", "integrity", "inspection"] as const;
export const CommandEvidenceClassSchema = z.enum(COMMAND_EVIDENCE_CLASSES);
export type CommandEvidenceClass = z.infer<typeof CommandEvidenceClassSchema>;

export const COMMAND_EVIDENCE_CLASS: Readonly<
  Record<GrantableCommandPrefix, CommandEvidenceClass>
> = Object.freeze({
  "npm run test": "acceptance",
  "npm run build": "integrity",
  "git status": "inspection",
  "git diff": "inspection",
});

/**
 * Classifies a command string a worker actually invoked.
 *
 * Longest-prefix wins, so `npm run test:unit` classifies as the `npm run test`
 * grant rather than falling through — which is what the compiled `Bash(npm run
 * test:*)` rule genuinely permits (see the widening note above). A string
 * matching no grant returns `undefined`: it was not granted, so nothing it did
 * counts as evidence of anything.
 */
export function classifyGrantedCommand(command: string): GrantableCommandPrefix | undefined {
  let matched: GrantableCommandPrefix | undefined;
  for (const prefix of GRANTABLE_COMMAND_PREFIXES) {
    if (!command.startsWith(prefix)) continue;
    if (matched === undefined || prefix.length > matched.length) matched = prefix;
  }
  return matched;
}

export const EnvelopePolicySchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    createdAt: TimestampSchema,

    /**
     * Worktree-relative directory prefixes a run may own. Containment is
     * segment-aware prefix containment — `src` contains `src/login` and does
     * not contain `srcfoo` — never glob matching: `validateOwnedPath` already
     * rejects glob metacharacters, and a second matching language on this
     * surface is where 03's CRITICAL confinement escape lived.
     */
    allowedPathPrefixes: z.array(NonEmptyStringSchema).default([]),

    /**
     * Build output and cache directories a worker may write outside its owned
     * paths — `dist`, `coverage`, `node_modules/.cache`, and whatever else
     * this project's own commands emit. This is the field that lets
     * `filesystem.allowWrite` be narrowed from the whole worktree to
     * `ownedPaths + these` without breaking every command the envelope
     * authorizes. Empty means the sandbox grants owned paths only.
     */
    allowedWriteScratchPaths: z.array(NonEmptyStringSchema).default([]),

    /** Closed vocabulary — see `GRANTABLE_COMMAND_PREFIXES` for why. */
    allowedCommands: z.array(GrantableCommandPrefixSchema).default([]),

    /** Bare domain names, matched exactly against `validateNetworkDestination` output. */
    allowedNetworkDestinations: z.array(NonEmptyStringSchema).default([]),

    /** Secret *references*, never values — matched exactly. */
    allowedCredentialReferences: z.array(NonEmptyStringSchema).default([]),

    /**
     * Remote resources a run may act on without asking. Empty — the default —
     * means **any** `remoteResourceAuthorizations` entry escalates.
     *
     * This replaces the balloted design's `autoGrantableHighImpactFlags`,
     * which roast F2/F3 refuted: the flag taxonomy is assigned by static
     * per-kind tables rather than by risk (a Grafana `dashboard` and a Jira
     * single-issue update both carry *no* flag, so "zero flags is trivially
     * contained" would have auto-granted rewriting a production dashboard),
     * and `RemoteMutationPlan.requiredCapabilityFlags` has no consumer at
     * apply time in any case. Gating on references is a control that exists;
     * gating on flags was one that existed only on paper.
     */
    allowedRemoteResourceReferences: z.array(NonEmptyStringSchema).default([]),

    /**
     * Whether a worker's sandbox may reach unix domain sockets.
     *
     * `emitSandboxProfile` sets `allowAllUnixSockets: true` unconditionally
     * today, which is why `allowedNetworkDestinations: []` does not currently
     * mean "no network" — a reachable docker socket is host-root write, and
     * `SSH_AUTH_SOCK` is not covered by the `~/.ssh` read deny (F4). Defaulting
     * this to `false` turns an ambient grant into a declared one. The Linux/WSL2
     * UDS gate the gateway itself needs is a separate concern and is not
     * governed by this flag.
     */
    allowUnixSockets: z.boolean().default(false),

    /**
     * Ceiling on the per-attempt worker turn budget an envelope may request
     * (turns are the authoritative unit, USD informational — adaptation
     * §5.7). `envelope.maxTurnsPerAttempt` must be ≤ this or the dispatch
     * escalates like any other escaping dimension.
     *
     * Defaults to **0 — grants nothing** (the numeric empty set), so a policy
     * on disk from before this axis existed denies it and every dispatch
     * escalates, naming this field, until the owner states a ceiling — F10's
     * fail-closed shape. A FLAT number, deliberately: `digestPolicy` hashes
     * the file's plain JSON, and the first nested field would silently change
     * the journaled authorization identity (`policy-store.ts`).
     */
    maxWorkerTurnsPerAttempt: z.number().int().nonnegative().default(0),
  })
  .strict();

export type EnvelopePolicy = z.infer<typeof EnvelopePolicySchema>;

/**
 * True when a policy grants nothing at all, so every dispatch would be refused.
 *
 * Exists because a vacuous policy passes every structural check a doctor can
 * make — it exists, it parses, it is `0600`, it is untracked — while making
 * the product completely non-functional (F9). Derivation on a repo with no
 * `package.json` produces exactly this. One definition, shared by the
 * installer (which must refuse to write one) and the doctor check (which must
 * fail on one), so the two cannot drift.
 *
 * Deliberately keyed on `allowedPathPrefixes` alone: a run that may write
 * nowhere can accomplish nothing, whatever else it is permitted, and every
 * other dimension legitimately defaults to empty.
 */
export function isVacuousPolicy(policy: EnvelopePolicy): boolean {
  return policy.allowedPathPrefixes.filter(isUsablePathPrefix).length === 0;
}

/**
 * Whether a declared path prefix can grant anything at all.
 *
 * Roast round 3 (F3) found the gap this closes: `allowedPathPrefixes:
 * ["src/**"]` — the natural way to write "everything under src" — parses, is
 * non-empty, and was therefore reported as a healthy policy, while the
 * containment check rejected it and refused every dispatch. `is-contained.ts`
 * documents that exact scenario in prose ("parses, is not vacuous, passes
 * every doctor check, matches nothing") and the fix had been applied to the
 * refusal message but not to the vacuity test written afterwards.
 *
 * Kept HERE, in the schema's own module, rather than in the containment
 * check: 02 owns the predicate's specification, and "does this policy grant
 * anything" must have exactly one answer shared by the installer, the doctor
 * check and containment. The rule mirrors `validateOwnedPath`'s — literal,
 * relative directory names — deliberately in the narrower, allow-listing
 * direction, so a form nobody has considered reads as unusable rather than as
 * a grant.
 */
export function isUsablePathPrefix(prefix: string): boolean {
  return normalizePathPrefix(prefix) !== undefined;
}

/**
 * THE canonical path-prefix normalizer. One implementation, so "is this
 * usable" and "what does it match" cannot disagree.
 *
 * Rounds 4, 5 and 6 each tried to keep a boolean predicate in step with the
 * containment check's own normalizer by re-deriving the same rules, and each
 * attempt diverged somewhere new — `"."`, then `"./~"`, then `"./ /src"`.
 * Round 7 measured the last attempt and found it made things WORSE: 1143
 * mismatches became 6895 across a 51,911-prefix corpus. Two functions that
 * must agree will not, however carefully each is written. So there is one,
 * and `@crabgic/engine-core`'s containment check calls it.
 *
 * Returns the collapsed, comparable form, or `undefined` when the prefix
 * cannot grant anything: empty, absolute, home-anchored, containing `..`,
 * carrying a glob metacharacter, or collapsing to no segments at all.
 *
 * SEGMENTS ARE NOT TRIMMED, and that is the whole correctness argument.
 * Round 7 trimmed them, and round 8 measured the result: **1791 containment
 * false positives** where round 6 had zero. The compiler is the authority on
 * what directory a path names, and `emitPermissionProfile` — which emits
 * `validateOwnedPath`'s output, trimming the whole string and nothing else —
 * is that authority's surviving expression. (Round 11 correction:
 * `narrowedAllowWrite` was cited here too and no longer qualifies, because
 * round 10 changed it to emit THIS function's output. The two now differ in
 * string form for 11,650 of 13,061 shared paths — `src/.` vs `src` — while
 * resolving to the identical POSIX directory in every one. The conclusion
 * stands; the premise had rotted, which matters because rounds 4-8 each went
 * wrong reasoning from this very paragraph.) So `"src /"` names a directory called
 * `"src "`, and a normalizer that trims it to `"src"` tells the gate a run is
 * contained while the compiler grants somewhere the owner never approved.
 * `is-contained.ts`'s own header calls that the unacceptable direction: "a
 * false positive is an unreviewed run with authority nobody granted".
 *
 * Not trimming also settles the tilde case correctly rather than by accident:
 * `"./~"` collapses to `"~"` and is refused, while `"./ ~"` collapses to
 * `" ~"` — a directory whose name begins with a space, which is odd but real,
 * and which the compiler would grant. Both answers now match what actually
 * gets emitted.
 */
export function normalizePathPrefix(prefix: string): string | undefined {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) return undefined;
  if (/[*?[\]{}\\]/.test(trimmed)) return undefined;

  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");

  if (segments.length === 0) return undefined;
  if (segments[0]!.startsWith("~")) return undefined;
  if (segments.some((segment) => segment === "..")) return undefined;
  return segments.join("/");
}
