/**
 * roadmap/10-plugin-and-installer.md exit criterion, suite
 * `merge.monotonic.property`: "Add-only merge property test passes: user
 * keys byte-preserved, security keys never loosened, over a fuzzed fixture
 * corpus." §Test plan, Property: "install→upgrade→uninstall preserves
 * every user-added key across randomly generated pre-existing
 * `CLAUDE.md`/`settings.json` fixtures; no generated merge ever loosens a
 * security key already present in the target repo (fuzzed over key
 * presence/absence/value combinations)."
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { mergeManagedTextBlock } from "./merge-text.js";
import { mergeSettingsJson } from "./settings-merge.js";
import { mergeMcpJson } from "./mcp-json-merge.js";

const PLUGIN = "engineering-orchestrator";

const jsonScalarArbitrary = fc.oneof(fc.boolean(), fc.integer(), fc.string(), fc.constant(null));

/**
 * A non-object JSON value — used to fuzz "present but wrong-typed"
 * `enabledPlugins`/`mcpServers` fixtures (adversarial-review regression,
 * 2026-07-24: these used to be silently clobbered when present as any of
 * these shapes).
 */
const nonObjectJsonArbitrary = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string()),
);

describe("merge.monotonic.property — CLAUDE.md text merge", () => {
  it("byte-preserves arbitrary pre-existing user content across a merge (add-only, never mutates user text)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (userContent, desiredBlock) => {
        const result = mergeManagedTextBlock(userContent, desiredBlock);
        // Every character of the user's own pre-existing content survives
        // somewhere in the merged output (either before or after the
        // block, since the merge never had a marker to replace).
        if (!userContent.includes("<!-- BEGIN ENGINEERING ORCHESTRATOR")) {
          expect(result.content.includes(userContent) || userContent.length === 0).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is always idempotent: merging the same desired content twice never changes the result a second time", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (userContent, desiredBlock) => {
        const first = mergeManagedTextBlock(userContent, desiredBlock).content;
        const second = mergeManagedTextBlock(first, desiredBlock);
        expect(second.changed).toBe(false);
        expect(second.content).toBe(first);
      }),
      { numRuns: 200 },
    );
  });
});

/**
 * Every shape `enabledPlugins`/`mcpServers` might already have in a target
 * project's config — fuzzed across "absent", "a plain object" (with or
 * without our own key already present), and "present but the WRONG type"
 * (adversarial-review regression, 2026-07-24: this last category used to
 * be silently clobbered).
 */
const mapLikeFixtureArbitrary = fc.oneof(
  fc.record({ kind: fc.constant("absent" as const) }),
  fc.record({
    kind: fc.constant("object-with-own" as const),
    ownValue: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("object-without-own" as const),
    otherEntries: fc.dictionary(fc.string({ minLength: 1 }), fc.boolean(), { maxKeys: 3 }),
  }),
  fc.record({
    kind: fc.constant("non-object" as const),
    value: nonObjectJsonArbitrary,
  }),
);

describe("merge.monotonic.property — settings.json add-only, security keys never loosened", () => {
  const arbitrarySettings = fc.record(
    {
      attribution: fc.option(fc.record({ commit: fc.string(), pr: fc.string() }), {
        nil: undefined,
      }),
      sessionUrl: fc.option(fc.boolean(), { nil: undefined }),
      enabledPluginsFixture: mapLikeFixtureArbitrary,
      userKeyName: fc
        .string({ minLength: 1 })
        .filter((s) => !["attribution", "sessionUrl", "enabledPlugins"].includes(s)),
      userKeyValue: jsonScalarArbitrary,
    },
    { requiredKeys: ["userKeyName", "userKeyValue", "enabledPluginsFixture"] },
  );

  it("never loosens attribution/sessionUrl/enabledPlugins once already present, over a fuzzed presence/absence/value/TYPE corpus", () => {
    fc.assert(
      fc.property(arbitrarySettings, (fixture) => {
        const existing: Record<string, unknown> = { [fixture.userKeyName]: fixture.userKeyValue };
        if (fixture.attribution !== undefined) existing.attribution = fixture.attribution;
        if (fixture.sessionUrl !== undefined) existing.sessionUrl = fixture.sessionUrl;

        const ep = fixture.enabledPluginsFixture;
        if (ep.kind === "object-with-own") {
          existing.enabledPlugins = { [PLUGIN]: ep.ownValue };
        } else if (ep.kind === "object-without-own") {
          existing.enabledPlugins = { ...ep.otherEntries };
        } else if (ep.kind === "non-object") {
          existing.enabledPlugins = ep.value;
        }
        // "absent": existing.enabledPlugins deliberately left unset.

        const result = mergeSettingsJson(existing, PLUGIN);

        // The user's own arbitrary key is always byte-preserved.
        expect(result.settings[fixture.userKeyName]).toEqual(fixture.userKeyValue);

        if (fixture.attribution !== undefined) {
          expect(result.settings.attribution).toEqual(fixture.attribution);
        }
        if (fixture.sessionUrl !== undefined) {
          expect(result.settings.sessionUrl).toBe(fixture.sessionUrl);
        }

        if (ep.kind === "absent") {
          expect(result.settings.enabledPlugins).toEqual({ [PLUGIN]: true });
        } else if (ep.kind === "object-with-own") {
          // Never re-widened, even `false` (explicitly disabled).
          expect((result.settings.enabledPlugins as Record<string, unknown>)[PLUGIN]).toBe(
            ep.ownValue,
          );
        } else if (ep.kind === "object-without-own") {
          expect(result.settings.enabledPlugins).toEqual({ ...ep.otherEntries, [PLUGIN]: true });
        } else {
          // ADVERSARIAL-REVIEW REGRESSION (2026-07-24): a present-but-
          // wrong-typed enabledPlugins is preserved BYTE-FOR-BYTE, never
          // clobbered.
          expect(result.settings.enabledPlugins).toEqual(ep.value);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("is always idempotent: merging twice in a row never changes anything the second time, across every enabledPlugins shape", () => {
    fc.assert(
      fc.property(arbitrarySettings, (fixture) => {
        const existing: Record<string, unknown> = { [fixture.userKeyName]: fixture.userKeyValue };
        const ep = fixture.enabledPluginsFixture;
        if (ep.kind === "object-with-own") existing.enabledPlugins = { [PLUGIN]: ep.ownValue };
        else if (ep.kind === "object-without-own") existing.enabledPlugins = { ...ep.otherEntries };
        else if (ep.kind === "non-object") existing.enabledPlugins = ep.value;

        const first = mergeSettingsJson(existing, PLUGIN).settings;
        const second = mergeSettingsJson(first, PLUGIN);
        expect(second.changed).toBe(false);
        expect(second.settings).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });
});

describe("merge.monotonic.property — .mcp.json add-only, mcpServers never loosened/clobbered", () => {
  const arbitraryMcpJson = fc.record({
    mcpServersFixture: mapLikeFixtureArbitrary,
    otherTopLevelKeyName: fc.string({ minLength: 1 }).filter((s) => s !== "mcpServers"),
    otherTopLevelKeyValue: jsonScalarArbitrary,
  });

  it("never clobbers a present mcpServers value regardless of its type, over a fuzzed corpus", () => {
    fc.assert(
      fc.property(arbitraryMcpJson, (fixture) => {
        const existing: Record<string, unknown> = {
          [fixture.otherTopLevelKeyName]: fixture.otherTopLevelKeyValue,
        };
        const ms = fixture.mcpServersFixture;
        if (ms.kind === "object-with-own") {
          existing.mcpServers = { [GATEWAY_MCP_SERVER_NAME]: ms.ownValue };
        } else if (ms.kind === "object-without-own") {
          existing.mcpServers = { ...ms.otherEntries };
        } else if (ms.kind === "non-object") {
          existing.mcpServers = ms.value;
        }

        const result = mergeMcpJson(existing);

        expect(result.mcpJson[fixture.otherTopLevelKeyName]).toEqual(fixture.otherTopLevelKeyValue);

        if (ms.kind === "absent") {
          expect(
            (result.mcpJson.mcpServers as Record<string, unknown>)[GATEWAY_MCP_SERVER_NAME],
          ).toBeDefined();
        } else if (ms.kind === "object-with-own") {
          expect(
            (result.mcpJson.mcpServers as Record<string, unknown>)[GATEWAY_MCP_SERVER_NAME],
          ).toBe(ms.ownValue);
        } else if (ms.kind === "object-without-own") {
          expect(result.mcpJson.mcpServers).toEqual({
            ...ms.otherEntries,
            [GATEWAY_MCP_SERVER_NAME]: expect.anything() as unknown,
          });
        } else {
          // ADVERSARIAL-REVIEW REGRESSION (2026-07-24): a present-but-
          // wrong-typed mcpServers is preserved byte-for-byte.
          expect(result.mcpJson.mcpServers).toEqual(ms.value);
        }
      }),
      { numRuns: 500 },
    );
  });
});
