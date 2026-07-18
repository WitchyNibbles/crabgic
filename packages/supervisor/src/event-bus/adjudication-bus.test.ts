/**
 * roadmap/05-supervisor-daemon.md §Security: "a crashed/timed-out
 * adjudication bridge resolves to deny, never allow (the property 06's
 * real implementation must also uphold)."
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { createAdjudicationBus, denyAllPolicy } from "./adjudication-bus.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-adjudication-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

const NO_OP_CONTEXT = { signal: new AbortController().signal };

describe("adjudication bus — fail-closed on ANY bridge failure", () => {
  it("a throwing policy resolves to deny, never allow", async () => {
    const adjudicate = createAdjudicationBus({
      journal: store,
      policy: async () => {
        throw new Error("policy crashed");
      },
    });
    const decision = await adjudicate("Bash", { command: "rm -rf /" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("a policy that never resolves (hangs) times out and resolves to deny, never allow", async () => {
    const adjudicate = createAdjudicationBus({
      journal: store,
      timeoutMs: 30,
      policy: () =>
        new Promise(() => {
          // never resolves — simulates a hung bridge
        }),
    });
    const decision = await adjudicate("Bash", { command: "ls" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("the default stub policy denies every tool call (fail-closed by default, matching roadmap 05's own stub)", async () => {
    const adjudicate = createAdjudicationBus({ journal: store });
    const decision = await adjudicate("Bash", { command: "ls" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("denyAllPolicy itself always returns deny", async () => {
    const decision = await denyAllPolicy("Bash", {}, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });

  it("an allowing policy's decision passes through unchanged", async () => {
    const adjudicate = createAdjudicationBus({
      journal: store,
      policy: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
    });
    const decision = await adjudicate("Read", { path: "x.ts" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("allow");
  });

  it("journals adjudication_decision for every call, allow and deny alike", async () => {
    const adjudicate = createAdjudicationBus({
      journal: store,
      policy: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
      runId: "11111111-1111-4111-8111-111111111111",
    });
    await adjudicate("Read", { path: "x.ts" }, NO_OP_CONTEXT);

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("journals with workUnitId set when provided", async () => {
    const adjudicate = createAdjudicationBus({
      journal: store,
      policy: async (_name, input) => ({ behavior: "allow", updatedInput: input }),
      workUnitId: "22222222-2222-4222-8222-222222222222",
    });
    await adjudicate("Read", { path: "x.ts" }, NO_OP_CONTEXT);

    const entries: { workUnitId?: string }[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision" })) {
      entries.push(entry as { workUnitId?: string });
    }
    expect(entries[0]?.workUnitId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("a policy that rejects with a non-Error value still fails closed (deny), never allow", async () => {
    const adjudicate = createAdjudicationBus({
      journal: store,
      policy: () => Promise.reject("plain string rejection"),
    });
    const decision = await adjudicate("Bash", { command: "ls" }, NO_OP_CONTEXT);
    expect(decision.behavior).toBe("deny");
  });
});
