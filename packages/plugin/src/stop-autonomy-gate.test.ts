import { describe, expect, it } from "vitest";
import { RUN_LIFECYCLE_STATES } from "@crabgic/contracts";
import {
  IN_FLIGHT_STATES,
  STOPPABLE_STATES,
  buildBlockReason,
  decideStopAction,
  queryRuns,
  readPayload,
  resolveCliCommand,
  main,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- plain .mjs hook, loaded directly by the engine; no .d.ts by design.
} from "../hooks/stop-autonomy-gate.mjs";

/**
 * The gate is a `.mjs` file because the engine loads it directly, but its
 * decision logic is pure and exported precisely so it can be tested here
 * without a supervisor, a CLI, or an engine.
 *
 * The single most important property under test is FAILS OPEN: this hook runs
 * on every session end in every project that has the plugin installed. A false
 * negative costs one unnecessary "continue"; a false positive costs the owner
 * a session they cannot exit. Every ambiguous input must therefore allow the
 * stop.
 */

describe("state partition", () => {
  it("covers every run-lifecycle state exactly once, with none invented", () => {
    // If a new state is added to @crabgic/contracts and not classified here,
    // the gate would silently treat it as "not in flight" and stop blocking.
    const partition = [...IN_FLIGHT_STATES, ...STOPPABLE_STATES].sort();
    expect(partition).toEqual([...RUN_LIFECYCLE_STATES].sort());
  });

  it("does not classify any state as both in-flight and stoppable", () => {
    const overlap = IN_FLIGHT_STATES.filter((s: string) => STOPPABLE_STATES.includes(s));
    expect(overlap).toEqual([]);
  });

  it("treats awaiting_approval as stoppable — the owner must be able to reach the gate", () => {
    // A run parked at awaiting_approval needs a human act the model is
    // forbidden from performing. Blocking here would trap the owner in a
    // session whose only exit is the thing the block prevents.
    expect(STOPPABLE_STATES).toContain("awaiting_approval");
    expect(IN_FLIGHT_STATES).not.toContain("awaiting_approval");
  });

  it("treats every absorbing state as stoppable", () => {
    for (const terminal of ["published_local", "failed", "blocked", "cancelled"]) {
      expect(STOPPABLE_STATES, terminal).toContain(terminal);
    }
  });
});

describe("decideStopAction", () => {
  const running = [{ runId: "run-1", state: "running" }];

  it("blocks when a run is in flight", () => {
    const decision = decideStopAction({}, running);
    expect(decision?.decision).toBe("block");
    expect(decision?.reason).toContain("run-1");
  });

  it("blocks for every in-flight state", () => {
    for (const state of IN_FLIGHT_STATES) {
      const decision = decideStopAction({}, [{ runId: "r", state }]);
      expect(decision?.decision, `state=${state}`).toBe("block");
    }
  });

  it("allows the stop for every stoppable state", () => {
    for (const state of STOPPABLE_STATES) {
      expect(decideStopAction({}, [{ runId: "r", state }]), `state=${state}`).toBeNull();
    }
  });

  it("honors the stop_hook_active loop guard before anything else", () => {
    // docs/engine-baseline.md §19.2. Without this the gate could wedge a
    // session, which is the worst failure mode available to it.
    expect(decideStopAction({ stop_hook_active: true }, running)).toBeNull();
  });

  it("allows the stop when run state could not be determined", () => {
    for (const runs of [null, undefined, "nonsense", 42, {}]) {
      expect(decideStopAction({}, runs), `runs=${JSON.stringify(runs)}`).toBeNull();
    }
  });

  it("allows the stop when there are no runs at all", () => {
    expect(decideStopAction({}, [])).toBeNull();
  });

  it("ignores malformed run records rather than throwing", () => {
    expect(decideStopAction({}, [null, undefined, {}, { state: 7 }, "x"])).toBeNull();
  });

  it("blocks when a valid in-flight run sits among malformed ones", () => {
    const decision = decideStopAction({}, [null, { state: 7 }, { runId: "ok", state: "running" }]);
    expect(decision?.decision).toBe("block");
  });

  it("tolerates a missing payload entirely", () => {
    expect(decideStopAction(undefined, [])).toBeNull();
    expect(decideStopAction(null, running)?.decision).toBe("block");
  });

  it("reports every in-flight run, not just the first", () => {
    const decision = decideStopAction({}, [
      { runId: "run-a", state: "running" },
      { runId: "run-b", state: "verifying" },
      { runId: "run-c", state: "cancelled" },
    ]);
    expect(decision?.reason).toContain("run-a");
    expect(decision?.reason).toContain("run-b");
    expect(decision?.reason).not.toContain("run-c");
  });
});

describe("buildBlockReason", () => {
  it("tells the model not to ask the owner to continue — the defect this exists to fix", () => {
    const reason = buildBlockReason([{ runId: "r", state: "running" }]);
    expect(reason).toMatch(/do not ask the owner/i);
    expect(reason).toMatch(/continue/i);
  });

  it("names the legitimate way out, so a real blocker is not mistaken for a stall", () => {
    const reason = buildBlockReason([{ runId: "r", state: "running" }]);
    expect(reason).toMatch(/seven stop conditions/i);
    expect(reason).toContain("AskUserQuestion");
  });

  it("agrees with itself grammatically for one run and for several", () => {
    expect(buildBlockReason([{ runId: "a", state: "running" }])).toContain("run is");
    expect(
      buildBlockReason([
        { runId: "a", state: "running" },
        { runId: "b", state: "running" },
      ]),
    ).toContain("runs are");
  });

  it("survives a run record with no id", () => {
    expect(buildBlockReason([{ state: "running" }])).toContain("unknown run");
  });
});

describe("readPayload", () => {
  it("parses a well-formed payload", () => {
    expect(readPayload(() => '{"cwd":"/x","stop_hook_active":false}')).toEqual({
      cwd: "/x",
      stop_hook_active: false,
    });
  });

  it("yields an empty object for anything unusable, never throwing", () => {
    const bad = [
      () => "",
      () => "   ",
      () => "not json",
      () => "null",
      () => "[1,2]" /* array is not a payload object */,
      () => "7",
      () => {
        throw new Error("EAGAIN");
      },
    ];
    for (const readFd of bad) {
      expect(() => readPayload(readFd)).not.toThrow();
    }
    expect(readPayload(() => "not json")).toEqual({});
    expect(readPayload(() => "null")).toEqual({});
  });
});

describe("resolveCliCommand", () => {
  it("prefers the vendored sibling CLI when it exists", () => {
    const resolved = resolveCliCommand(() => true);
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]).toMatch(/bin\.js$/);
  });

  it("falls back to PATH in a monorepo checkout", () => {
    const resolved = resolveCliCommand(() => false);
    expect(resolved.command).toBe("crabgic");
    expect(resolved.args).toEqual([]);
  });
});

describe("queryRuns", () => {
  const okResolve = () => ({ command: "crabgic", args: [] });

  it("passes CRABGIC_NO_SPAWN so a session ending never boots a daemon", () => {
    let seenEnv: Record<string, string> = {};
    queryRuns(
      "/proj",
      (_cmd: string, _args: string[], opts: { env: Record<string, string> }) => {
        seenEnv = opts.env;
        return { status: 0, stdout: '{"runs":[]}' };
      },
      okResolve,
    );
    expect(seenEnv.CRABGIC_NO_SPAWN).toBe("1");
  });

  it("asks for JSON status in the payload's project directory", () => {
    let seenArgs: string[] = [];
    let seenCwd = "";
    queryRuns(
      "/proj",
      (_cmd: string, args: string[], opts: { cwd: string }) => {
        seenArgs = args;
        seenCwd = opts.cwd;
        return { status: 0, stdout: '{"runs":[]}' };
      },
      okResolve,
    );
    expect(seenArgs).toEqual(["status", "--json"]);
    expect(seenCwd).toBe("/proj");
  });

  it("applies a timeout, so a hung CLI cannot stall the turn", () => {
    let seenTimeout = 0;
    queryRuns(
      "/proj",
      (_c: string, _a: string[], opts: { timeout: number }) => {
        seenTimeout = opts.timeout;
        return { status: 0, stdout: '{"runs":[]}' };
      },
      okResolve,
    );
    expect(seenTimeout).toBeGreaterThan(0);
    expect(seenTimeout).toBeLessThanOrEqual(5000);
  });

  it("returns the run array on success", () => {
    const runs = queryRuns(
      "/proj",
      () => ({ status: 0, stdout: '{"runs":[{"runId":"r","state":"running"}]}' }),
      okResolve,
    );
    expect(runs).toEqual([{ runId: "r", state: "running" }]);
  });

  it("returns null — never throws — for every failure mode", () => {
    const failures: Array<[string, unknown]> = [
      ["spawn threw", null],
      ["nonzero exit", { status: 1, stdout: "" }],
      ["spawn error", { status: 0, error: new Error("ENOENT"), stdout: "" }],
      ["no result", undefined],
      ["malformed json", { status: 0, stdout: "{{{" }],
      ["json without runs", { status: 0, stdout: '{"other":true}' }],
      ["runs not an array", { status: 0, stdout: '{"runs":"nope"}' }],
    ];
    for (const [label, result] of failures) {
      const run =
        result === null
          ? () => {
              throw new Error("spawn failed");
            }
          : () => result;
      expect(queryRuns("/proj", run, okResolve), label).toBeNull();
    }
  });
});

describe("main", () => {
  function runMain(payload: unknown, runs: unknown) {
    const written: string[] = [];
    const asked: string[] = [];
    main({
      read: () => payload,
      query: (cwd: string) => {
        asked.push(cwd);
        return runs;
      },
      write: (s: string) => written.push(s),
    });
    return { written, asked };
  }

  it("writes a block decision when a run is in flight", () => {
    const { written } = runMain({ cwd: "/proj" }, [{ runId: "r1", state: "running" }]);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toMatchObject({ decision: "block" });
  });

  it("writes nothing at all when the turn may end", () => {
    expect(runMain({ cwd: "/proj" }, []).written).toEqual([]);
  });

  it("asks about the project directory the payload names", () => {
    expect(runMain({ cwd: "/some/project" }, []).asked).toEqual(["/some/project"]);
  });

  it("falls back to process.cwd() when the payload has no usable cwd", () => {
    // docs/engine-baseline.md §19.3 records `cwd` as present; this is the
    // documented fallback for the case it ever is not.
    for (const payload of [{}, { cwd: "" }, { cwd: 42 }]) {
      expect(runMain(payload, []).asked, JSON.stringify(payload)).toEqual([process.cwd()]);
    }
  });

  it("short-circuits on re-entry without querying anything", () => {
    // The loop guard must cost nothing: no CLI spawn on the re-entered Stop.
    const { written, asked } = runMain({ stop_hook_active: true, cwd: "/proj" }, [
      { runId: "r1", state: "running" },
    ]);
    expect(written).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("stays silent when run state cannot be determined", () => {
    expect(runMain({ cwd: "/proj" }, null).written).toEqual([]);
  });
});
