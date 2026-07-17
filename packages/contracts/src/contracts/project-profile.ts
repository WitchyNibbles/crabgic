import { z } from "zod";
import { SchemaVersionField } from "../shared/schema-version.js";
import { IdSchema, NonEmptyStringSchema, TimestampSchema } from "../shared/ids.js";

/**
 * `TestCommands` — the stack-native test-invocation commands a gate/benchmark
 * runner dispatches (roadmap/14-quality-security-gates.md §In scope, "Test
 * execution": "unit/integration/E2E via stack-native commands declared on
 * `ProjectProfile` (02)"). `unit` is mandatory — every ecosystem the system
 * gates must at minimum declare how to run its unit suite; `integration`/
 * `e2e` are optional because not every package has them.
 */
export const TestCommandsSchema = z
  .object({
    unit: NonEmptyStringSchema,
    integration: NonEmptyStringSchema.optional(),
    e2e: NonEmptyStringSchema.optional(),
  })
  .strict();
export type TestCommands = z.infer<typeof TestCommandsSchema>;

/**
 * One ecosystem's command set within a (possibly monorepo) project.
 * `ecosystem` is a free-form label (e.g. "node", "python", "go", "rust")
 * rather than a closed union — roadmap/12-stack-detection-quarantine.md's own
 * fixture matrix ("node/ts monorepo, python, go, rust, mixed, containerized",
 * §Test plan) never pins a closed ecosystem taxonomy, so this phase does not
 * invent one. `packagePath` supports the same monorepo shape (use `"."` for
 * a single-stack repo root) — minimal shape chosen: no field in either
 * roadmap/12 or roadmap/14 pins an exact monorepo-addressing scheme, and a
 * relative path is the smallest sufficient one. `buildCommand` and
 * `benchmarkCommand` are optional per-ecosystem (roadmap/15-performance-
 * contracts.md §In scope, "Adapters": "generic command benchmark (any
 * `ProjectProfile`-declared benchmark command...)"); not every ecosystem has
 * a meaningful build step or a registered benchmark.
 */
export const EcosystemProfileSchema = z
  .object({
    ecosystem: NonEmptyStringSchema,
    packagePath: NonEmptyStringSchema,
    buildCommand: NonEmptyStringSchema.optional(),
    testCommands: TestCommandsSchema,
    benchmarkCommand: NonEmptyStringSchema.optional(),
  })
  .strict();
export type EcosystemProfile = z.infer<typeof EcosystemProfileSchema>;

/**
 * `ProjectProfile` (roadmap/02-contracts-and-schemas.md §Interfaces
 * produced, row "ProjectProfile | 06, 14"): the "how to run this stack's own
 * commands" schema, as distinguished from `StackEvidence`'s "whether a gate
 * category applies at all" role (roadmap/14-quality-security-gates.md
 * §Risks, "`StackEvidence` vs `ProjectProfile`" bullet, quoting
 * roadmap/12-stack-detection-quarantine.md §Risks: "`ProjectProfile` says
 * *how* to run a stack's own tests, `StackEvidence` says *whether* a gate
 * category applies at all"). At least one ecosystem is required — a
 * `ProjectProfile` with zero declared ecosystems has nothing for 14/15 to
 * dispatch against.
 */
export const ProjectProfileSchema = z
  .object({
    schemaVersion: SchemaVersionField,
    id: IdSchema,
    createdAt: TimestampSchema,
    ecosystems: z.array(EcosystemProfileSchema).min(1),
  })
  .strict();
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
