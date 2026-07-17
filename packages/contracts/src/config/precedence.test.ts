import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CONFIG_LAYER_ORDER,
  SecurityKeyLoosenedError,
  resolveConfig,
  type ConfigLayer,
  type ConfigLayers,
} from "./precedence.js";
import type { SecurityKeyDeclaration } from "./security-keys.js";

/**
 * Config precedence resolver tests (roadmap/02 work item 8; Test plan's
 * property + adversarial Security bullets; exit criterion: "Property tests
 * prove no random config-layer stack can loosen a declared security key
 * (≥10k fast-check cases, zero counterexamples)").
 */

function emptyLayers(overrides: Partial<ConfigLayers> = {}): ConfigLayers {
  return {
    cli: {},
    env: {},
    project: {},
    user: {},
    defaults: {},
    ...overrides,
  };
}

/** Captures whatever `fn` throws (or `undefined` if it doesn't), for inspecting a typed error's fields. */
function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

const BOOLEAN_KEY: SecurityKeyDeclaration = {
  kind: "booleanOneWay",
  key: "sandboxEnabled",
  secureValue: true,
};

const NUMERIC_KEY: SecurityKeyDeclaration = {
  kind: "numericMinWins",
  key: "maxConcurrentWorkers",
};

const DENY_LIST_KEY: SecurityKeyDeclaration = {
  kind: "denyList",
  key: "deniedToolPatterns",
};

describe("resolveConfig — unit fixtures", () => {
  it(
    "rejects a config stack that lowers a security-key boolean " +
      "(roadmap/02 work item 8 failing-first fixture)",
    () => {
      const layers = emptyLayers({
        defaults: { sandboxEnabled: true },
        cli: { sandboxEnabled: false },
      });

      expect(() => resolveConfig(layers, [BOOLEAN_KEY])).toThrow(SecurityKeyLoosenedError);
    },
  );

  it("allows a higher-precedence layer to tighten a security-key boolean", () => {
    const layers = emptyLayers({
      defaults: { sandboxEnabled: false },
      cli: { sandboxEnabled: true },
    });

    const resolved = resolveConfig(layers, [BOOLEAN_KEY]);
    expect(resolved["sandboxEnabled"]).toBe(true);
  });

  it("rejects a config stack that raises a min-wins numeric security key", () => {
    const layers = emptyLayers({
      defaults: { maxConcurrentWorkers: 2 },
      cli: { maxConcurrentWorkers: 8 },
    });

    expect(() => resolveConfig(layers, [NUMERIC_KEY])).toThrow(SecurityKeyLoosenedError);
  });

  it("allows a higher-precedence layer to tighten a min-wins numeric security key", () => {
    const layers = emptyLayers({
      defaults: { maxConcurrentWorkers: 8 },
      cli: { maxConcurrentWorkers: 2 },
    });

    const resolved = resolveConfig(layers, [NUMERIC_KEY]);
    expect(resolved["maxConcurrentWorkers"]).toBe(2);
  });

  it("accumulates deny-list entries across every layer (union, append-only)", () => {
    const layers = emptyLayers({
      defaults: { deniedToolPatterns: ["Bash(rm -rf *)"] },
      project: { deniedToolPatterns: ["WebFetch"] },
      cli: { deniedToolPatterns: ["Agent"] },
    });

    const resolved = resolveConfig(layers, [DENY_LIST_KEY]);
    expect(resolved["deniedToolPatterns"]).toEqual(["Agent", "Bash(rm -rf *)", "WebFetch"]);
  });

  it("a higher-precedence layer cannot shrink the resolved deny list", () => {
    const layers = emptyLayers({
      defaults: { deniedToolPatterns: ["Bash(rm -rf *)", "WebFetch"] },
      cli: { deniedToolPatterns: [] },
    });

    const resolved = resolveConfig(layers, [DENY_LIST_KEY]);
    expect(resolved["deniedToolPatterns"]).toEqual(["Bash(rm -rf *)", "WebFetch"]);
  });

  it("non-security keys follow plain CLI > env > project > user > defaults precedence", () => {
    const layers = emptyLayers({
      cli: { model: "cli-value" },
      env: { model: "env-value" },
      project: { model: "project-value" },
      user: { model: "user-value" },
      defaults: { model: "defaults-value" },
    });

    expect(resolveConfig(layers, []).model).toBe("cli-value");
  });

  it("falls through to the next-highest layer that defines a plain key when higher layers omit it", () => {
    const layers = emptyLayers({
      project: { model: "project-value" },
      defaults: { model: "defaults-value" },
    });

    expect(resolveConfig(layers, []).model).toBe("project-value");
  });

  it("CONFIG_LAYER_ORDER is exactly CLI, env, project, user, defaults (CLI highest)", () => {
    expect(CONFIG_LAYER_ORDER).toEqual(["cli", "env", "project", "user", "defaults"]);
  });

  it("is a pure function — never mutates any input layer", () => {
    const cliLayer: ConfigLayer = { deniedToolPatterns: ["Agent"], sandboxEnabled: true };
    const defaultsLayer: ConfigLayer = { deniedToolPatterns: ["WebFetch"], sandboxEnabled: true };
    const layers = emptyLayers({ cli: cliLayer, defaults: defaultsLayer });
    const snapshotBefore = JSON.parse(JSON.stringify(layers)) as unknown;

    resolveConfig(layers, [DENY_LIST_KEY, BOOLEAN_KEY]);

    expect(JSON.parse(JSON.stringify(layers))).toEqual(snapshotBefore);
  });

  it("SecurityKeyLoosenedError carries structured, typed fields (typed rejection)", () => {
    const layers = emptyLayers({
      defaults: { sandboxEnabled: true },
      user: { sandboxEnabled: false },
    });

    const thrown = captureThrown(() => resolveConfig(layers, [BOOLEAN_KEY]));
    expect(thrown).toBeInstanceOf(SecurityKeyLoosenedError);
    const typed = thrown as InstanceType<typeof SecurityKeyLoosenedError>;
    expect(typed.key).toBe("sandboxEnabled");
    expect(typed.kind).toBe("booleanOneWay");
    expect(typed.loosenedByLayer).toBe("user");
    expect(typed.tightenedByLayer).toBe("defaults");
  });
});

describe("resolveConfig — fast-check property: security-key monotonicity", () => {
  interface PerLayerValues<T> {
    readonly cli: T | undefined;
    readonly env: T | undefined;
    readonly project: T | undefined;
    readonly user: T | undefined;
    readonly defaults: T | undefined;
  }

  interface LayerSample {
    readonly boolValues: PerLayerValues<boolean>;
    readonly numValues: PerLayerValues<number>;
    readonly listValues: PerLayerValues<readonly string[]>;
  }

  /** One arbitrary per config layer, each independently possibly-absent (sparse layering). */
  function perLayerArb<T>(valueArb: fc.Arbitrary<T>): fc.Arbitrary<PerLayerValues<T>> {
    const optionalValueArb = fc.option(valueArb, { nil: undefined });
    return fc.record({
      cli: optionalValueArb,
      env: optionalValueArb,
      project: optionalValueArb,
      user: optionalValueArb,
      defaults: optionalValueArb,
    });
  }

  const layersArb: fc.Arbitrary<LayerSample> = fc.record({
    boolValues: perLayerArb(fc.boolean()),
    numValues: perLayerArb(fc.integer({ min: 0, max: 64 })),
    listValues: perLayerArb(
      fc.array(fc.constantFrom("Agent", "WebFetch", "WebSearch"), { maxLength: 3 }),
    ),
  });

  function toLayers(sample: LayerSample): ConfigLayers {
    const build = (name: keyof PerLayerValues<unknown>): ConfigLayer => {
      const layer: Record<string, boolean | number | readonly string[]> = {};
      const b = sample.boolValues[name];
      const n = sample.numValues[name];
      const l = sample.listValues[name];
      if (b !== undefined) layer["sandboxEnabled"] = b;
      if (n !== undefined) layer["maxConcurrentWorkers"] = n;
      if (l !== undefined) layer["deniedToolPatterns"] = l;
      return layer;
    };
    return {
      cli: build("cli"),
      env: build("env"),
      project: build("project"),
      user: build("user"),
      defaults: build("defaults"),
    };
  }

  it("no CLI/env/project/user/defaults combination ever loosens a declared security key (10000 fast-check cases)", () => {
    fc.assert(
      fc.property(layersArb, (sample) => {
        const layers = toLayers(sample);
        const declarations: SecurityKeyDeclaration[] = [BOOLEAN_KEY, NUMERIC_KEY, DENY_LIST_KEY];

        let resolved;
        try {
          resolved = resolveConfig(layers, declarations);
        } catch (error) {
          expect(error).toBeInstanceOf(SecurityKeyLoosenedError);
          return;
        }

        // Deny list: always the exact sorted union of every layer's array.
        const unionSet = new Set<string>();
        for (const name of CONFIG_LAYER_ORDER) {
          for (const entry of (layers[name]["deniedToolPatterns"] as
            readonly string[] | undefined) ?? []) {
            unionSet.add(entry);
          }
        }
        const expectedDenyList = [...unionSet].sort();
        expect(resolved["deniedToolPatterns"] ?? []).toEqual(expectedDenyList);

        // Boolean: if any layer explicitly declared the secure value, resolved must be secure.
        const anyLayerSecure = CONFIG_LAYER_ORDER.some(
          (name) => layers[name]["sandboxEnabled"] === true,
        );
        if (anyLayerSecure) {
          expect(resolved["sandboxEnabled"]).toBe(true);
        }

        // Numeric: if resolved is present, it must be <= every layer's own declared value
        // (i.e. it is at least as restrictive as every individual layer).
        if (resolved["maxConcurrentWorkers"] !== undefined) {
          for (const name of CONFIG_LAYER_ORDER) {
            const layerValue = layers[name]["maxConcurrentWorkers"] as number | undefined;
            if (layerValue !== undefined) {
              expect(resolved["maxConcurrentWorkers"] as number).toBeLessThanOrEqual(layerValue);
            }
          }
        }
      }),
      { numRuns: 10000 },
    );
  });
});

describe("resolveConfig — adversarial corpus (Test plan Security bullet)", () => {
  it("always rejects an adversarial attempt to flip a boolean security key from a lower-precedence layer", () => {
    const higherThanLowerPairs: ReadonlyArray<
      readonly [(typeof CONFIG_LAYER_ORDER)[number], (typeof CONFIG_LAYER_ORDER)[number]]
    > = [
      ["cli", "env"],
      ["cli", "project"],
      ["cli", "user"],
      ["cli", "defaults"],
      ["env", "project"],
      ["env", "user"],
      ["env", "defaults"],
      ["project", "user"],
      ["project", "defaults"],
      ["user", "defaults"],
    ];

    fc.assert(
      fc.property(fc.constantFrom(...higherThanLowerPairs), fc.boolean(), (pair, secureValue) => {
        const [higherLayer, lowerLayer] = pair;
        const layers = emptyLayers({
          [lowerLayer]: { sandboxEnabled: secureValue },
          [higherLayer]: { sandboxEnabled: !secureValue },
        });

        expect(() =>
          resolveConfig(layers, [{ kind: "booleanOneWay", key: "sandboxEnabled", secureValue }]),
        ).toThrow(SecurityKeyLoosenedError);
      }),
      { numRuns: 5000 },
    );
  });

  it("always rejects an adversarial attempt to raise a min-wins numeric security key from a lower-precedence layer", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 21, max: 100 }),
        (tightValue, looseValue) => {
          const layers = emptyLayers({
            defaults: { maxConcurrentWorkers: tightValue },
            cli: { maxConcurrentWorkers: looseValue },
          });

          expect(() => resolveConfig(layers, [NUMERIC_KEY])).toThrow(SecurityKeyLoosenedError);
        },
      ),
      { numRuns: 5000 },
    );
  });

  it("an attempt to inject a wider allow list (shrink the deny list) from any layer never shrinks the resolved deny list", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("Agent", "WebFetch", "WebSearch"), { minLength: 1, maxLength: 3 }),
        (baseline) => {
          const layers = emptyLayers({
            defaults: { deniedToolPatterns: baseline },
            cli: { deniedToolPatterns: [] },
          });

          const resolved = resolveConfig(layers, [DENY_LIST_KEY]) as Readonly<
            Record<string, readonly string[]>
          >;
          for (const entry of baseline) {
            expect(resolved["deniedToolPatterns"]).toContain(entry);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
