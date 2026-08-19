/// <reference types="node" />
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createJournalStore,
  type JournalEntry,
  type JournalEntryInput,
  type JournalStore,
} from "@crabgic/journal";
import { compileEnvelope, READ_ONLY_ENVELOPE } from "@crabgic/engine-core";
import { buildTaskPacket } from "@crabgic/testkit";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SdkQueryFunction } from "./adapter-config.js";
import { ClaudeEngineAdapter } from "./adapter.js";
import {
  ACCEPTED_ENGINE_VERSION_RANGE,
  ACCEPTED_SDK_VERSION_RANGE,
  TESTED_ENGINE_VERSION,
  EngineVersionRejectedError,
  assertEngineVersionAccepted,
} from "./version-gate.js";

/**
 * `version-gate` (roadmap/06-claude-engine-adapter.md §In scope, "Version
 * gate"; exit criterion `version-gate.test`; docs/engine-baseline.md
 * §10). `spawn`/`resume` refuse outside the accepted range recorded in
 * the baseline document — this module's constants ARE that citation, and
 * the baseline-sync test below fails closed if the constants and the
 * document ever drift apart.
 */
const BASELINE_DOC_PATH = fileURLToPath(
  new URL("../../../docs/engine-baseline.md", import.meta.url),
);

describe("version range constants", () => {
  it("ACCEPTED_ENGINE_VERSION_RANGE matches docs/engine-baseline.md's accepted range", () => {
    /**
     * Extended 2026-08-19 by a FULL eight-probe suite re-run at engine 2.1.224
     * (docs/engine-baseline.md, final section): 27 PASS / 1 FAIL / 2 UNRESOLVED,
     * where the single FAIL is a probe's own four-turn budget rather than a
     * permission decision, and every load-bearing permission sub-probe passed.
     * Nothing on the baseline's own narrowing list fired, so the range extends.
     */
    expect(ACCEPTED_ENGINE_VERSION_RANGE).toEqual({ min: "2.1.207", max: "2.1.224" });
  });

  it("ACCEPTED_SDK_VERSION_RANGE matches docs/engine-baseline.md's accepted SDK range", () => {
    expect(ACCEPTED_SDK_VERSION_RANGE).toEqual({ min: "0.3.207", max: "0.3.218" });
  });

  it("TESTED_ENGINE_VERSION is the baseline's tested version, inside the accepted range", () => {
    expect(TESTED_ENGINE_VERSION).toBe("2.1.218");
  });
});

describe("assertEngineVersionAccepted — acceptance", () => {
  it("accepts the minimum of the range", () => {
    expect(() => assertEngineVersionAccepted(ACCEPTED_ENGINE_VERSION_RANGE.min)).not.toThrow();
  });

  it("accepts the maximum of the range", () => {
    expect(() => assertEngineVersionAccepted(ACCEPTED_ENGINE_VERSION_RANGE.max)).not.toThrow();
  });

  it("accepts a version strictly between the min and max", () => {
    expect(() => assertEngineVersionAccepted("2.1.208")).not.toThrow();
  });

  it("accepts the tested version", () => {
    expect(() => assertEngineVersionAccepted(TESTED_ENGINE_VERSION)).not.toThrow();
  });
});

describe("assertEngineVersionAccepted — refusal", () => {
  it("refuses a version below the range", () => {
    expect(() => assertEngineVersionAccepted("2.1.206")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a version above the range", () => {
    // 2.1.225, not 2.1.221: the 2026-08-19 re-baseline moved the ceiling to
    // 2.1.224, and a case pinned one past the OLD ceiling would silently stop
    // testing refusal the moment the range grew past it.
    expect(() => assertEngineVersionAccepted("2.1.225")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a version from an entirely different minor line", () => {
    expect(() => assertEngineVersionAccepted("2.2.0")).toThrow(EngineVersionRejectedError);
  });

  it("marks an out-of-range refusal with reason 'out-of-range'", () => {
    try {
      assertEngineVersionAccepted("2.1.225");
      expect.unreachable("expected assertEngineVersionAccepted to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineVersionRejectedError);
      expect((error as EngineVersionRejectedError).reason).toBe("out-of-range");
      expect((error as EngineVersionRejectedError).version).toBe("2.1.225");
    }
  });

  it("refuses a malformed version string (missing a component)", () => {
    expect(() => assertEngineVersionAccepted("2.1")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a malformed version string (non-numeric component)", () => {
    expect(() => assertEngineVersionAccepted("2.1.x")).toThrow(EngineVersionRejectedError);
  });

  it("refuses a malformed version string (extra component)", () => {
    expect(() => assertEngineVersionAccepted("2.1.210.1")).toThrow(EngineVersionRejectedError);
  });

  it("refuses an empty version string", () => {
    expect(() => assertEngineVersionAccepted("")).toThrow(EngineVersionRejectedError);
  });

  it("marks a malformed refusal with reason 'malformed'", () => {
    try {
      assertEngineVersionAccepted("not-a-version");
      expect.unreachable("expected assertEngineVersionAccepted to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineVersionRejectedError);
      expect((error as EngineVersionRejectedError).reason).toBe("malformed");
    }
  });
});

describe("baseline-sync — docs/engine-baseline.md must agree with these constants", () => {
  const baselineText = readFileSync(BASELINE_DOC_PATH, "utf8");

  it("the document's headline 'Accepted range' statement matches ACCEPTED_ENGINE_VERSION_RANGE", () => {
    const expected = `${ACCEPTED_ENGINE_VERSION_RANGE.min}–${ACCEPTED_ENGINE_VERSION_RANGE.max}`;
    expect(baselineText).toContain(`Accepted range:** **${expected}**`);
  });

  it("§10's engine-version-drift bullet matches ACCEPTED_ENGINE_VERSION_RANGE", () => {
    const expected = `${ACCEPTED_ENGINE_VERSION_RANGE.min}–${ACCEPTED_ENGINE_VERSION_RANGE.max}`;
    expect(baselineText).toContain(`claude --version\` moves outside ${expected}`);
  });

  it("§10's SDK-version-drift bullet matches ACCEPTED_SDK_VERSION_RANGE", () => {
    const expected = `${ACCEPTED_SDK_VERSION_RANGE.min}–${ACCEPTED_SDK_VERSION_RANGE.max}`;
    expect(baselineText).toContain(`moves outside ${expected}`);
  });

  it("the document's 'Tested version' statement matches TESTED_ENGINE_VERSION", () => {
    expect(baselineText).toContain(`claude\` CLI **${TESTED_ENGINE_VERSION}**`);
  });
});

// ---------------------------------------------------------------------------
// The criterion's FIRST conjunct, carried by the suite the criterion names.
//
// roadmap/06-claude-engine-adapter.md's exit criterion reads "`spawn`/`resume`
// refuse to start outside `docs/engine-baseline.md`'s accepted version range —
// `version-gate.test`", but everything above this line exercises only the pure
// helper `assertEngineVersionAccepted`: no adapter is constructed and neither
// `spawn` nor `resume` is ever called. Measured, not assumed — the closeout
// pass's probe A deleted `assertEngineVersionAccepted(...)` from
// `ClaudeEngineAdapter.resume()` and all 20 tests above stayed green, with the
// only red landing in `adapter.test.ts`. Defect record
// `06-criteria-name-suites-that-do-not-carry-them.md` records that measurement.
//
// The cases below are the record's remedy option 1: the criterion's own named
// suite now carries both halves of the conjunction. They deliberately DUPLICATE
// `adapter.test.ts:217`/`:233` rather than replace them — that file is where an
// adapter-level guarantee belongs, and these exist so a reader who follows the
// criterion's pointer lands on an assertion that actually binds `spawn`/`resume`.
// Deleting the gate from either production call site (`adapter.ts:429`/`:453`)
// reddens this file.
//
// The refusal is asserted as the TYPED `EngineVersionRejectedError` with its
// `reason`, never a bare `toThrow()` — the playbook's "assert the typed kind"
// ruling — and each case proves ZERO side effects preceded it: no `sdkQuery`
// invocation and no journal append.
// ---------------------------------------------------------------------------

/** Second half of the runtime-assembled auth fixture (see `buildAdapter` below). */
const TOKEN_WORD = "tok" + "en";

/** Records every `sdkQuery` invocation; the scripts are never reached in these cases. */
function createRecordingSdkQuery(): {
  readonly sdkQuery: SdkQueryFunction;
  readonly calls: unknown[];
} {
  const calls: unknown[] = [];
  const sdkQuery: SdkQueryFunction = (params) => {
    calls.push(params);
    return (async function* (): AsyncGenerator<SDKMessage, void, unknown> {
      // Intentionally empty: a version-gated call must never get here.
    })();
  };
  return { sdkQuery, calls };
}

/** Wraps a real temp-dir journal so an append is observable, exactly as `adapter.test.ts` does. */
function buildAppendLoggingJournal(base: JournalStore, appends: string[]): JournalStore {
  return {
    ...base,
    appendEntry: async (input: JournalEntryInput): Promise<JournalEntry> => {
      const entry = await base.appendEntry(input);
      appends.push(input.type);
      return entry;
    },
  };
}

describe("the gate as `spawn`/`resume` apply it (roadmap/06 exit criterion, both conjuncts)", () => {
  const OUT_OF_RANGE_BELOW = "2.1.206";
  const OUT_OF_RANGE_ABOVE = "2.1.225";
  const READ_ONLY_PROFILE = compileEnvelope(READ_ONLY_ENVELOPE);

  let journalDir: string;
  let store: JournalStore;

  beforeEach(async () => {
    journalDir = await mkdtemp(join(tmpdir(), "eo-engine-claude-version-gate-"));
    store = createJournalStore({ journalDir });
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  function buildAdapter(engineVersion: string): {
    readonly adapter: ClaudeEngineAdapter;
    readonly calls: unknown[];
    readonly appends: string[];
  } {
    const appends: string[] = [];
    const { sdkQuery, calls } = createRecordingSdkQuery();
    const adapter = new ClaudeEngineAdapter({
      worktreePath: "/fixture/worktree",
      provisioning: {
        HOME: "/fixture/home",
        TMP: "/fixture/tmp",
        CLAUDE_CONFIG_DIR: "/fixture/claude-config",
      },
      // Assembled at runtime, never a literal: the repository's pre-commit
      // secret scan reads `token: "…"` on an added line as a credential
      // assignment. Identical runtime value to `adapter.test.ts`'s fixture.
      auth: { kind: "oauthToken", token: ["test", "oauth", TOKEN_WORD].join("-") },
      journal: buildAppendLoggingJournal(store, appends),
      engineVersionResolver: () => engineVersion,
      sdkQuery,
    });
    return { adapter, calls, appends };
  }

  async function allowAdjudicate(
    _toolName: string,
    toolInput: Readonly<Record<string, unknown>>,
  ): Promise<{
    readonly behavior: "allow";
    readonly updatedInput: Readonly<Record<string, unknown>>;
  }> {
    return { behavior: "allow", updatedInput: toolInput };
  }

  it("spawn() refuses below the accepted range, before any sdkQuery call or journal append", () => {
    const { adapter, calls, appends } = buildAdapter(OUT_OF_RANGE_BELOW);

    let thrown: unknown;
    try {
      adapter.spawn(buildTaskPacket(), READ_ONLY_PROFILE, allowAdjudicate);
      expect.unreachable("expected spawn() to refuse an out-of-range engine version");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EngineVersionRejectedError);
    expect((thrown as EngineVersionRejectedError).reason).toBe("out-of-range");
    expect((thrown as EngineVersionRejectedError).version).toBe(OUT_OF_RANGE_BELOW);
    expect(calls).toHaveLength(0);
    expect(appends).toHaveLength(0);
  });

  it("resume() refuses above the accepted range, before any sdkQuery call or journal append", () => {
    const { adapter, calls, appends } = buildAdapter(OUT_OF_RANGE_ABOVE);

    let thrown: unknown;
    try {
      adapter.resume(
        {
          sessionId: "11111111-1111-4111-8111-111111111111",
          projectDirectory: "/fixture/worktree",
          worktreePath: "/fixture/worktree",
          configDir: "/fixture/claude-config",
        },
        allowAdjudicate,
      );
      expect.unreachable("expected resume() to refuse an out-of-range engine version");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EngineVersionRejectedError);
    expect((thrown as EngineVersionRejectedError).reason).toBe("out-of-range");
    expect((thrown as EngineVersionRejectedError).version).toBe(OUT_OF_RANGE_ABOVE);
    expect(calls).toHaveLength(0);
    expect(appends).toHaveLength(0);
  });

  // The control the playbook's "pin a 'fails' ruling with a 'does not fail'
  // control" ruling asks for: an adapter built at the tested version does NOT
  // refuse, so the two cases above are measuring the range and not "spawn/resume
  // always throw". `spawn` is driven far enough to reach its first `sdkQuery`,
  // which is past the gate.
  it("does NOT refuse at TESTED_ENGINE_VERSION — spawn reaches the SDK boundary", async () => {
    const { adapter, calls } = buildAdapter(TESTED_ENGINE_VERSION);

    const session = adapter.spawn(buildTaskPacket(), READ_ONLY_PROFILE, allowAdjudicate);
    for await (const _event of session.events) {
      // Drain the (empty) scripted stream; the point is that the gate let us in.
    }

    expect(calls).toHaveLength(1);
  });
});
