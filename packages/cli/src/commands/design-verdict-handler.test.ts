import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDesignGate } from "@crabgic/contracts";
import { runDesignVerdictCommand } from "./design-verdict-handler.js";
import { loadDesignVerdicts, verdictInForce } from "../review/design-verdict-store.js";
import { parseCommand } from "../argv/parse-command.js";
import { EXIT_OK } from "../exit-codes.js";

/**
 * `crabgic design approve|reject` — roadmap/25 work item 5, the design gate's
 * only write path.
 *
 * The gate refuses everything until a verdict is recorded, and this command is
 * the sole way to record one. It is a CLI command rather than a gateway tool for
 * the reason the whole gate rests on: nothing reachable from a session may write
 * it, or the model could approve its own design.
 */

let home: string;
let deps: { designVerdictsPath: string; stateHome: string; now: () => Date };

const CHANGE_SET = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crabgic-design-cmd-"));
  deps = {
    designVerdictsPath: join(home, "state", "design-verdicts.json"),
    stateHome: join(home, "state"),
    now: () => new Date("2026-08-15T00:00:00.000Z"),
  };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("the argv surface", () => {
  it("parses `design approve <id> --revision <rev>`", () => {
    const parsed = parseCommand(["design", "approve", CHANGE_SET, "--revision", "sha256:abc"]);
    expect(parsed).toMatchObject({
      command: "design-approve",
      changeSetId: CHANGE_SET,
      revision: "sha256:abc",
    });
  });

  it("REFUSES an approval with no --revision", () => {
    // A verdict that does not name what it was given over carries forward
    // across an edit -- approving something nobody read.
    expect(() => parseCommand(["design", "approve", CHANGE_SET])).toThrow(/revision/i);
  });

  it("REFUSES a rejection with no --reason", () => {
    // Refused at the point of typing as well as by the schema. The design stage
    // loops on this reason; without it the next round has nothing to change.
    expect(() =>
      parseCommand(["design", "reject", CHANGE_SET, "--revision", "sha256:abc"]),
    ).toThrow(/reason/i);
  });

  it("refuses an unknown design sub-command", () => {
    expect(() => parseCommand(["design", "bless", CHANGE_SET])).toThrow(/approve\|reject/);
  });
});

describe("runDesignVerdictCommand", () => {
  it("records an approval that the gate then accepts", async () => {
    // The claim that matters: the command and the gate agree. Either half alone
    // proves nothing -- a write nobody reads and a reader with no write both
    // look exactly like a gate that works.
    const result = await runDesignVerdictCommand(
      {
        command: "design-approve",
        changeSetId: CHANGE_SET,
        revision: "sha256:abc",
        json: false,
      },
      deps,
    );
    expect(result.exitCode).toBe(EXIT_OK);

    const inForce = verdictInForce(await loadDesignVerdicts(deps.designVerdictsPath), CHANGE_SET);
    expect(
      resolveDesignGate({
        ...(inForce !== undefined ? { ownerVerdict: inForce } : {}),
        designRevision: "sha256:abc",
      }).closable,
    ).toBe(true);
  });

  it("records a rejection the gate refuses, carrying the reason", async () => {
    await runDesignVerdictCommand(
      {
        command: "design-reject",
        changeSetId: CHANGE_SET,
        revision: "sha256:abc",
        reason: "the queue is the wrong shape",
        json: false,
      },
      deps,
    );
    const inForce = verdictInForce(await loadDesignVerdicts(deps.designVerdictsPath), CHANGE_SET);
    const gate = resolveDesignGate({
      ...(inForce !== undefined ? { ownerVerdict: inForce } : {}),
      designRevision: "sha256:abc",
    });
    expect(gate.closable).toBe(false);
    expect(gate.reason).toMatch(/the queue is the wrong shape/);
  });

  it("does NOT open the gate for a revision it did not approve", async () => {
    await runDesignVerdictCommand(
      { command: "design-approve", changeSetId: CHANGE_SET, revision: "sha256:v1", json: false },
      deps,
    );
    const inForce = verdictInForce(await loadDesignVerdicts(deps.designVerdictsPath), CHANGE_SET);
    expect(
      resolveDesignGate({
        ...(inForce !== undefined ? { ownerVerdict: inForce } : {}),
        designRevision: "sha256:v2-edited",
      }).closable,
    ).toBe(false);
  });

  it("stamps the time itself rather than accepting it", async () => {
    // A caller-supplied `recordedAt` could be backdated, and the only thing
    // that field is for is telling a later reader when the owner answered.
    await runDesignVerdictCommand(
      { command: "design-approve", changeSetId: CHANGE_SET, revision: "sha256:abc", json: false },
      deps,
    );
    const [recorded] = await loadDesignVerdicts(deps.designVerdictsPath);
    expect(recorded?.recordedAt).toBe("2026-08-15T00:00:00.000Z");
  });

  it("emits machine-readable output under --json", async () => {
    const result = await runDesignVerdictCommand(
      { command: "design-approve", changeSetId: CHANGE_SET, revision: "sha256:abc", json: true },
      deps,
    );
    const parsed = JSON.parse(result.stdout ?? "{}") as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("surfaces the store's refusal verbatim rather than a bare failure", async () => {
    // An operator told only "failed" cannot tell a typo from a tampered state
    // directory, and those need different responses.
    const result = await runDesignVerdictCommand(
      {
        command: "design-approve",
        changeSetId: "not-a-uuid",
        revision: "sha256:abc",
        json: false,
      },
      deps,
    );
    expect(result.exitCode).not.toBe(EXIT_OK);
    expect(result.stderr).toMatch(/invalid design verdict/i);
  });
});
