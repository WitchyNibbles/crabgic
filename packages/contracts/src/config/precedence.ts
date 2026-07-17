import { z } from "zod";
import {
  SecurityKeyDeclarationSchema,
  DEFAULT_SECURITY_KEY_DECLARATIONS,
  type SecurityKeyDeclaration,
} from "./security-keys.js";

/**
 * Config precedence order, CLI highest (roadmap/02-contracts-and-
 * schemas.md §In scope, "Config precedence resolver" bullet: "CLI → env →
 * project → user → defaults" — CLI highest). This is the product's OWN
 * config layering, distinct from (and parallel to) the engine's native
 * settings precedence (docs/claude-code-adaptation.md, "Settings docs"
 * bullet: "precedence managed → CLI → local → project → user").
 */
export const CONFIG_LAYER_ORDER = ["cli", "env", "project", "user", "defaults"] as const;
export const ConfigLayerNameSchema = z.enum(CONFIG_LAYER_ORDER);
export type ConfigLayerName = z.infer<typeof ConfigLayerNameSchema>;

/** A single config value: string, number, boolean, or a string array (deny-list shape). */
export const ConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()).readonly(),
]);
export type ConfigValue = z.infer<typeof ConfigValueSchema>;

/** One layer's own key→value map. Sparse — a layer need not declare every key. */
export const ConfigLayerSchema = z.record(z.string(), ConfigValueSchema);
export type ConfigLayer = z.infer<typeof ConfigLayerSchema>;

/** All 5 layers, keyed by layer name. Every layer object must be present (may be `{}`). */
export const ConfigLayersSchema = z.object({
  cli: ConfigLayerSchema,
  env: ConfigLayerSchema,
  project: ConfigLayerSchema,
  user: ConfigLayerSchema,
  defaults: ConfigLayerSchema,
});
export type ConfigLayers = z.infer<typeof ConfigLayersSchema>;

/** The fully-resolved, single-layer config produced by `resolveConfig`. */
export type ResolvedConfig = Readonly<Record<string, ConfigValue>>;

/**
 * Thrown by `resolveConfig` when a higher-precedence layer explicitly
 * declares a security-key value that is strictly less restrictive than a
 * lower-precedence layer's own explicit value for the same key (roadmap/02
 * work item 8's failing-first fixture: "a config stack that lowers a
 * security-key boolean must be rejected before the resolver exists"; Test
 * plan Security bullet: "adversarial fast-check corpus attempting to
 * inject a wider allow list or flip a boolean security key from a
 * lower-precedence config layer, asserting the resolver always rejects").
 *
 * Never thrown for `denyList` keys: those accumulate via union and have no
 * "remove" operation to reject in the first place — the accumulation
 * itself is the security guarantee (see `resolveDenyListKey` below).
 */
export class SecurityKeyLoosenedError extends Error {
  readonly key: string;
  readonly kind: "booleanOneWay" | "numericMinWins";
  readonly loosenedByLayer: ConfigLayerName;
  readonly tightenedByLayer: ConfigLayerName;

  constructor(
    key: string,
    kind: "booleanOneWay" | "numericMinWins",
    loosenedByLayer: ConfigLayerName,
    tightenedByLayer: ConfigLayerName,
    detail: string,
  ) {
    super(
      `config precedence: layer "${loosenedByLayer}" attempted to loosen security key "${key}" ` +
        `below the value already declared by lower-precedence layer "${tightenedByLayer}" (${detail})`,
    );
    this.name = "SecurityKeyLoosenedError";
    this.key = key;
    this.kind = kind;
    this.loosenedByLayer = loosenedByLayer;
    this.tightenedByLayer = tightenedByLayer;
  }
}

/** Every key declared, by any layer, anywhere across the 5-layer stack. */
function collectAllKeys(layers: ConfigLayers): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const name of CONFIG_LAYER_ORDER) {
    for (const key of Object.keys(layers[name])) keys.add(key);
  }
  return keys;
}

/** Plain (non-security) key resolution: the highest-precedence layer that defines it wins. */
function resolvePlainKey(key: string, layers: ConfigLayers): ConfigValue | undefined {
  for (const name of CONFIG_LAYER_ORDER) {
    const value = layers[name][key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Deny-list resolution: the UNION of every layer's array for `key`,
 * deduplicated and sorted for determinism. Accumulate-only — there is no
 * pathway by which a higher-precedence layer's (possibly empty, possibly
 * narrower) array can remove an entry a lower-precedence layer added.
 */
function resolveDenyListKey(key: string, layers: ConfigLayers): readonly string[] {
  const union = new Set<string>();
  for (const name of CONFIG_LAYER_ORDER) {
    const value = layers[name][key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw new TypeError(
        `config precedence: deny-list security key "${key}" must be a string[] in every layer that declares it`,
      );
    }
    for (const entry of value) union.add(entry);
  }
  return [...union].sort();
}

/**
 * One-way boolean resolution. Walks layers from LOWEST to HIGHEST
 * precedence, tracking the first (lowest-precedence) layer that declared
 * `secureValue`. Once that has happened, any higher-precedence layer
 * explicitly declaring the opposite value is a rejected loosening attempt.
 * If no layer ever declares `secureValue`, resolution falls back to plain
 * highest-precedence-wins among the layers that declared the key at all.
 */
function resolveBooleanOneWayKey(
  key: string,
  secureValue: boolean,
  layers: ConfigLayers,
): boolean | undefined {
  const lowestToHighest = [...CONFIG_LAYER_ORDER].reverse();
  let secureSetByLayer: ConfigLayerName | undefined;
  let lastExplicitValue: boolean | undefined;

  for (const name of lowestToHighest) {
    const raw = layers[name][key];
    if (raw === undefined) continue;
    if (typeof raw !== "boolean") {
      throw new TypeError(
        `config precedence: boolean security key "${key}" must be a boolean in every layer that declares it`,
      );
    }

    if (secureSetByLayer !== undefined && raw !== secureValue) {
      throw new SecurityKeyLoosenedError(
        key,
        "booleanOneWay",
        name,
        secureSetByLayer,
        `layer "${secureSetByLayer}" declared the secure value (${secureValue}); layer "${name}" declared ${raw}`,
      );
    }

    if (raw === secureValue && secureSetByLayer === undefined) {
      secureSetByLayer = name;
    }
    lastExplicitValue = raw;
  }

  return secureSetByLayer !== undefined ? secureValue : lastExplicitValue;
}

/**
 * Min-wins numeric resolution. Walks layers from LOWEST to HIGHEST
 * precedence, tracking the tightest (smallest) value declared so far. A
 * higher-precedence layer explicitly declaring a larger (looser) number is
 * a rejected loosening attempt; a tightening (smaller-or-equal) value is
 * always allowed and updates the tightest-so-far tracker.
 */
function resolveNumericMinWinsKey(key: string, layers: ConfigLayers): number | undefined {
  const lowestToHighest = [...CONFIG_LAYER_ORDER].reverse();
  let tightestValue: number | undefined;
  let tightestLayer: ConfigLayerName | undefined;

  for (const name of lowestToHighest) {
    const raw = layers[name][key];
    if (raw === undefined) continue;
    if (typeof raw !== "number") {
      throw new TypeError(
        `config precedence: numeric security key "${key}" must be a number in every layer that declares it`,
      );
    }

    if (tightestValue !== undefined && raw > tightestValue) {
      throw new SecurityKeyLoosenedError(
        key,
        "numericMinWins",
        name,
        // tightestLayer is always defined once tightestValue is defined.
        tightestLayer as ConfigLayerName,
        `layer "${tightestLayer}" declared the tighter limit ${tightestValue}; layer "${name}" declared the looser limit ${raw}`,
      );
    }

    if (tightestValue === undefined || raw < tightestValue) {
      tightestValue = raw;
      tightestLayer = name;
    }
  }

  return tightestValue;
}

/**
 * Resolves a 5-layer config stack (CLI → env → project → user → defaults,
 * CLI highest) into a single flat config (roadmap/02-contracts-and-
 * schemas.md §In scope, "Config precedence resolver" bullet; work item 8).
 * Pure function — never mutates any input layer; always returns a fresh,
 * frozen object.
 *
 * For every key declared as a `SecurityKeyDeclaration` (see
 * `security-keys.ts`), lower precedence only tightens: deny lists are
 * append-only unions, booleans move one-way toward their declared secure
 * value, and numeric limits resolve to the minimum (most restrictive)
 * value across every layer — regardless of which layer's rank is highest.
 * A higher-precedence layer's EXPLICIT attempt to loosen a boolean or
 * numeric security key below what a lower-precedence layer already
 * declared throws `SecurityKeyLoosenedError` rather than being silently
 * overridden or silently ignored.
 *
 * Every other key (not in `securityKeyDeclarations`) resolves via plain
 * highest-precedence-wins override.
 */
export function resolveConfig(
  layers: ConfigLayers,
  securityKeyDeclarations: readonly SecurityKeyDeclaration[] = DEFAULT_SECURITY_KEY_DECLARATIONS,
): ResolvedConfig {
  const parsedLayers = ConfigLayersSchema.parse(layers);
  for (const declaration of securityKeyDeclarations) {
    SecurityKeyDeclarationSchema.parse(declaration);
  }

  const declarationByKey = new Map<string, SecurityKeyDeclaration>(
    securityKeyDeclarations.map((declaration) => [declaration.key, declaration] as const),
  );

  const resolved: Record<string, ConfigValue> = {};

  for (const key of collectAllKeys(parsedLayers)) {
    const declaration = declarationByKey.get(key);

    if (declaration === undefined) {
      const value = resolvePlainKey(key, parsedLayers);
      if (value !== undefined) resolved[key] = value;
      continue;
    }

    switch (declaration.kind) {
      case "denyList": {
        resolved[key] = resolveDenyListKey(key, parsedLayers);
        break;
      }
      case "booleanOneWay": {
        const value = resolveBooleanOneWayKey(key, declaration.secureValue, parsedLayers);
        if (value !== undefined) resolved[key] = value;
        break;
      }
      case "numericMinWins": {
        const value = resolveNumericMinWinsKey(key, parsedLayers);
        if (value !== undefined) resolved[key] = value;
        break;
      }
      default: {
        const exhaustive: never = declaration;
        throw new TypeError(
          `config precedence: unreachable security key kind: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  return Object.freeze(resolved);
}
