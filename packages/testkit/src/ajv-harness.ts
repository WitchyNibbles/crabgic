/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ErrorObject } from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import { CONTRACT_FIXTURES } from "./fixtures/registry.js";

// `ajv-formats` ships only a default CJS export; under this repo's pinned
// `moduleResolution: "NodeNext"` + `verbatimModuleSyntax`, a plain
// `import addFormats from "ajv-formats"` default import — and even a
// namespace import's own `.default` property — mistypes as the whole CJS
// module-namespace object rather than the callable plugin function (a
// known interop wrinkle for CJS-only packages with no `package.json`
// "exports" map — the same reason `ajv`'s own default export needed the
// named-import workaround above). The runtime value is correct (verified:
// `ajvFormatsModule.default` really is the callable plugin function at
// runtime — see `ajv-harness.test.ts`'s passing assertions); only the
// static type is wrong, so this is an explicit, narrow, documented
// `as unknown as` correction, not a behavior change.
const addFormats = ajvFormatsModule.default as unknown as (ajvInstance: Ajv) => void;

/**
 * INTEGRATION HARNESS — roadmap/02-contracts-and-schemas.md Test plan,
 * "Integration" bullet: "every testkit fixture builder round-trips through
 * its contract's own zod schema and JSON Schema export in one harness
 * pass — the same harness 03/16/18/19/20/22 import rather than re-deriving
 * fixtures." Exported from this package's `index.ts` for exactly that
 * reuse.
 *
 * Settings chosen (documented per this worker's brief):
 *  - `ajv-formats` is registered so ajv understands the `format: "uuid"`
 *    and `format: "date-time"` keywords `IdSchema`/`TimestampSchema`
 *    compile to (`packages/contracts/scripts/build-schemas.ts`'s own
 *    `target: "jsonSchema7"` choice emits exactly these two format
 *    keywords, never a custom one).
 *  - `packages/contracts/scripts/build-schemas.ts` uses `$refStrategy:
 *    "none"`, so every emitted `schemas/<kebabName>.json` file is fully
 *    self-contained (no `$ref`/`definitions` indirection) — `ajv.compile`
 *    never needs a second schema registered first.
 *  - `allErrors: true` so a failing validation reports every violated
 *    keyword in one pass, not just the first — useful when a fixture
 *    default and its own contract's schema drift apart during development.
 */

const CONTRACTS_SCHEMAS_SUBPATH_PREFIX = "@eo/contracts/schemas/";

export interface JsonSchemaValidationResult {
  readonly kebabName: string;
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * One shared, pre-configured ajv instance for every JSON-schema validation
 * this harness performs. Callers validating many fixtures in one pass
 * should construct one instance and reuse it (see
 * `validateAllFixturesAgainstEmittedJsonSchemas` below) — `ajv.compile`
 * itself is not free.
 */
export function createContractSchemaValidator(): Ajv {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv;
}

/**
 * Loads `packages/contracts/schemas/<kebabName>.json` via `@eo/contracts`'s
 * own `./schemas/*.json` export-map subpath (resolved through
 * `import.meta.resolve`, then read from disk — never re-derived here, so
 * this harness always validates against the exact artifact
 * `build-schemas.ts` produced, byte-for-byte).
 */
function loadEmittedJsonSchema(kebabName: string): object {
  const resolvedUrl = import.meta.resolve(`${CONTRACTS_SCHEMAS_SUBPATH_PREFIX}${kebabName}.json`);
  const raw = readFileSync(fileURLToPath(resolvedUrl), "utf8");
  return JSON.parse(raw) as object;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): readonly string[] {
  return (errors ?? []).map(
    (error) => `${error.instancePath || "(root)"} ${error.message ?? "invalid"}`,
  );
}

/**
 * Validates one already-built fixture instance against its contract's
 * emitted `schemas/<kebabName>.json` file.
 */
export function validateAgainstEmittedJsonSchema(
  kebabName: string,
  instance: unknown,
  ajv: Ajv = createContractSchemaValidator(),
): JsonSchemaValidationResult {
  const jsonSchema = loadEmittedJsonSchema(kebabName);
  const validate = ajv.compile(jsonSchema);
  const valid = validate(instance);
  return {
    kebabName,
    valid,
    errors: valid ? [] : formatAjvErrors(validate.errors),
  };
}

/**
 * Runs every registered contract fixture builder's default output through
 * `validateAgainstEmittedJsonSchema` — one harness pass over all 21
 * contracts, reused (never re-derived) by 03/16/18/19/20/22.
 */
export function validateAllFixturesAgainstEmittedJsonSchemas(): readonly JsonSchemaValidationResult[] {
  const ajv = createContractSchemaValidator();
  return CONTRACT_FIXTURES.map(({ kebabName, build }) =>
    validateAgainstEmittedJsonSchema(kebabName, build(), ajv),
  );
}
