import { z } from "zod";
import { NonEmptyStringSchema } from "../shared/ids.js";
import { STACK_EVIDENCE_CATEGORIES, type StackEvidence } from "./stack-evidence.js";

/**
 * `DOMAIN_LENSES` — the per-domain review roster.
 * `docs/design/owner-pipeline-conformance.md` §5.2; roadmap/25 work item 1.
 *
 * WHY THIS IS DATA AND NOT A FOLDER OF AGENT FILES. The owner asked (2026-08-15)
 * for a design panel of specialists per domain — backend, front-end,
 * infrastructure, testing, product design, and the target domain — and for four
 * evaluators on the implement stage. The obvious implementation is six or eight
 * `.md` files under `packages/plugin/agents/`. That was rejected for one reason:
 * a roster of files is a plugin-packaging concern, and no check can enumerate
 * it. "We ran five of the six lenses" and "we ran all six" would look identical
 * from the outside, which is the inert-control failure `docs/deploy-posture.md`
 * exists to surface, applied to review coverage.
 *
 * As data the roster is countable, and the load-bearing half follows: a lens
 * that DOES NOT apply is reported as skipped, with its reason, rather than
 * silently not running. `lensesApplicableTo` partitions — nothing falls out.
 *
 * WHY THE PREDICATE IS DATA AND NOT A FUNCTION. `appliesWhen` could have been
 * `(stack) => boolean`, which is shorter and cannot be schema-validated. A lens
 * with no predicate would then be representable, and the check that a lens
 * claiming to always apply has SAID SO would have nowhere to live. The owner's
 * own framing is the argument: "a lens that always applies is a claim, and it
 * must be written as one."
 *
 * These lenses EXTEND the nine in `eo-reviewer`'s charter rather than replacing
 * them. `security` and `correctness` are already pipeline lenses on the
 * implement stage; what the audit found missing was `compliance` and
 * `clean-code`, so those two are here and the existing pair is not duplicated.
 */

export const DOMAIN_LENS_IDS = [
  "backend",
  "frontend",
  "infrastructure",
  "testing",
  "product-design",
  "target-domain",
  "compliance",
  "clean-code",
] as const;
export type DomainLensId = (typeof DOMAIN_LENS_IDS)[number];

/**
 * A lens that runs on every change set, with the reason written down.
 *
 * `because` is required and non-empty. An unconditional lens is the expensive
 * kind — it fires on every change set of every project — so the schema makes
 * someone state the justification rather than letting "always" be the default
 * anyone reaches for when the predicate is hard to write.
 */
export const AlwaysAppliesSchema = z
  .object({
    kind: z.literal("always"),
    because: NonEmptyStringSchema,
  })
  .strict();

/**
 * A lens gated on what the project actually contains.
 *
 * Matching is a disjunction: any finding whose `category` is listed, or whose
 * `ecosystem` matches a listed token, makes the lens apply.
 *
 * `ecosystem` is deliberately free-form upstream (`stack-evidence.ts` — roadmap
 * 12 never pinned a closed taxonomy), so ecosystem matching is a
 * case-insensitive substring test against declared tokens rather than an
 * equality test against an enum that does not exist. Category matching IS
 * closed, and is validated against `STACK_EVIDENCE_CATEGORIES` so a typo fails
 * at parse rather than becoming a lens that never fires.
 *
 * `.refine` rejects a predicate that lists neither, because a predicate that
 * can never match is a lens that silently never runs — the state this whole
 * module exists to make impossible.
 */
export const StackAppliesSchema = z
  .object({
    kind: z.literal("stack"),
    anyCategory: z.array(z.enum(STACK_EVIDENCE_CATEGORIES)).default([]),
    anyEcosystem: z.array(NonEmptyStringSchema).default([]),
  })
  .strict()
  .refine(
    (predicate) => predicate.anyCategory.length > 0 || predicate.anyEcosystem.length > 0,
    "a stack predicate that lists neither a category nor an ecosystem can never match",
  );

export const AppliesWhenSchema = z.union([AlwaysAppliesSchema, StackAppliesSchema]);
export type AppliesWhen = z.infer<typeof AppliesWhenSchema>;

/**
 * `question` is the single thing this lens answers, and the schema requires it
 * to be one — `eo-reviewer`'s charter is explicit that a lens duplicating
 * another's work "wastes a round without adding a perspective".
 */
export const DomainLensSchema = z
  .object({
    id: z.enum(DOMAIN_LENS_IDS),
    question: NonEmptyStringSchema,
    appliesWhen: AppliesWhenSchema,
  })
  .strict();
export type DomainLens = z.infer<typeof DomainLensSchema>;

/**
 * Ecosystem tokens that indicate a browser-facing surface.
 *
 * Not exhaustive and not claimed to be: it is a substring allowlist over a
 * free-form field, so a stack this list does not name reports the frontend lens
 * as SKIPPED rather than silently omitting it. That is the failure mode this
 * design accepts, and it is visible by construction.
 */
const FRONTEND_ECOSYSTEMS = [
  "react",
  "vue",
  "svelte",
  "angular",
  "next",
  "nuxt",
  "browser",
  "css",
  "html",
  "tailwind",
] as const;

/** Ecosystem tokens that indicate server-side code. Same caveat as above. */
const BACKEND_ECOSYSTEMS = [
  "node",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "ruby",
  "php",
  "dotnet",
  "elixir",
] as const;

/** Tokens indicating a surface a person operates directly. */
const USER_SURFACE_ECOSYSTEMS = [...FRONTEND_ECOSYSTEMS, "cli", "tui", "mobile"] as const;

export const DOMAIN_LENSES: readonly DomainLens[] = [
  {
    id: "backend",
    question:
      "Does the server-side design hold under the loads, failures and concurrent access it will actually see?",
    appliesWhen: {
      kind: "stack",
      anyCategory: ["migration", "deployment_config"],
      anyEcosystem: [...BACKEND_ECOSYSTEMS],
    },
  },
  {
    id: "frontend",
    question:
      "What does a person actually see and do here, and does the interface hold up for someone not already expecting it?",
    appliesWhen: { kind: "stack", anyCategory: [], anyEcosystem: [...FRONTEND_ECOSYSTEMS] },
  },
  {
    id: "infrastructure",
    question:
      "How does this get deployed, rolled back and observed, and what happens when the environment it assumes is absent?",
    appliesWhen: {
      kind: "stack",
      anyCategory: ["container", "infrastructure", "deployment_config", "ci"],
      anyEcosystem: [],
    },
  },
  {
    id: "testing",
    question:
      "Do the tests fail for the reason they claim to, and would they still fail if the implementation were wrong in a way nobody anticipated?",
    appliesWhen: {
      kind: "always",
      because:
        "the repository's first ground rule is TDD, so every change set carries a test obligation whatever it is written in",
    },
  },
  {
    id: "product-design",
    question:
      "Does this solve the problem the owner actually described, rather than the nearest problem that was easier to build?",
    appliesWhen: { kind: "stack", anyCategory: [], anyEcosystem: [...USER_SURFACE_ECOSYSTEMS] },
  },
  {
    id: "target-domain",
    question:
      "What does someone who works in this subject area every day know that this design does not reflect?",
    appliesWhen: {
      kind: "always",
      because:
        "every project has a subject matter; what varies is whether anyone on the panel knows it, which is a staffing question and not an applicability one",
    },
  },
  {
    id: "compliance",
    question:
      "What obligation — licence, data handling, retention, dependency provenance — does this change touch without answering?",
    appliesWhen: {
      kind: "always",
      because:
        "licence and dependency provenance apply to every change set that adds code or a dependency, which is every change set",
    },
  },
  {
    id: "clean-code",
    question:
      "What will the next person to open this file have to reconstruct because it was never written down?",
    appliesWhen: {
      kind: "always",
      because: "every change set writes code that somebody else will later have to read",
    },
  },
];

/** One lens that did not run, and why. Never an empty reason. */
export interface SkippedLens {
  readonly lens: DomainLensId;
  readonly reason: string;
}

export interface LensApplicability {
  readonly applicable: readonly DomainLens[];
  readonly skipped: readonly SkippedLens[];
}

function matchesStack(predicate: AppliesWhen, evidence: StackEvidence): boolean {
  if (predicate.kind === "always") return true;
  return evidence.findings.some((finding) => {
    if ((predicate.anyCategory as readonly string[]).includes(finding.category)) return true;
    const ecosystem = finding.ecosystem.toLowerCase();
    return predicate.anyEcosystem.some((token) => ecosystem.includes(token.toLowerCase()));
  });
}

function skipReason(predicate: AppliesWhen): string {
  /* c8 ignore next -- an `always` predicate never reaches the skip branch; the
     guard exists so a future predicate kind cannot silently produce an empty
     reason, which is the one thing a skipped lens may not have. */
  if (predicate.kind === "always") return "unreachable: an unconditional lens is never skipped";
  const wanted = [
    ...predicate.anyCategory.map((category) => `category ${category}`),
    ...predicate.anyEcosystem.map((ecosystem) => `ecosystem matching "${ecosystem}"`),
  ];
  return `no stack evidence found for ${wanted.join(", ")}`;
}

/**
 * Partitions the roster against what the project contains.
 *
 * The return is a PARTITION and is tested as one: every lens is in exactly one
 * side. A function returning only the applicable lenses would have been
 * shorter and would have lost the property the roster exists for — that a lens
 * which did not run is visible, with its reason, rather than absent.
 */
export function lensesApplicableTo(evidence: StackEvidence): LensApplicability {
  const applicable: DomainLens[] = [];
  const skipped: SkippedLens[] = [];
  for (const lens of DOMAIN_LENSES) {
    if (matchesStack(lens.appliesWhen, evidence)) applicable.push(lens);
    else skipped.push({ lens: lens.id, reason: skipReason(lens.appliesWhen) });
  }
  return { applicable, skipped };
}

/**
 * Throws for an unknown id rather than returning `undefined`.
 *
 * Same reasoning as `exitCriteriaFor` in `./pipeline-stages.ts`: a lookup that
 * answers "nothing" for a typo becomes a lens that silently never runs, and
 * silent non-running is the exact failure the roster is data to prevent.
 */
export function domainLensById(id: DomainLensId): DomainLens {
  const lens = DOMAIN_LENSES.find((candidate) => candidate.id === id);
  if (lens === undefined) throw new Error(`unknown domain lens: ${id}`);
  return lens;
}
