import { describe, expect, it } from "vitest";
import { CliUsageError, SecretValueRejectedError } from "../errors.js";
import { parseCommand } from "./parse-command.js";

describe("parseCommand", () => {
  it("parses install with --dry-run --json", () => {
    expect(parseCommand(["install", "--dry-run", "--json"])).toEqual({
      command: "install",
      dryRun: true,
      json: true,
    });
  });

  it("parses doctor with --repair-plan", () => {
    expect(parseCommand(["doctor", "--repair-plan"])).toEqual({
      command: "doctor",
      repairPlan: true,
      json: false,
    });
  });

  it("parses status with an optional run-id and --watch", () => {
    expect(parseCommand(["status", "11111111-1111-4111-8111-111111111111", "--watch"])).toEqual({
      command: "status",
      runId: "11111111-1111-4111-8111-111111111111",
      watch: true,
      json: false,
    });
  });

  it("parses status with no run-id", () => {
    expect(parseCommand(["status"])).toEqual({ command: "status", watch: false, json: false });
  });

  it("parses resume, requiring run-id", () => {
    expect(parseCommand(["resume", "run-1"])).toEqual({
      command: "resume",
      runId: "run-1",
      json: false,
    });
    expect(() => parseCommand(["resume"])).toThrow(CliUsageError);
  });

  it("parses cancel, requiring run-id|task-id", () => {
    expect(parseCommand(["cancel", "task-1"])).toEqual({
      command: "cancel",
      targetId: "task-1",
      json: false,
    });
  });

  it("parses evidence, requiring change-set-id", () => {
    expect(parseCommand(["evidence", "cs-1", "--json"])).toEqual({
      command: "evidence",
      changeSetId: "cs-1",
      json: true,
    });
    expect(() => parseCommand(["evidence"])).toThrow(CliUsageError);
  });

  it("parses connection add with a valid secret reference", () => {
    expect(
      parseCommand(["connection", "add", "jira", "--reference", "env:JIRA_TOKEN"]),
    ).toEqual({
      command: "connection-add",
      provider: "jira",
      reference: { raw: "env:JIRA_TOKEN" },
      json: false,
    });
  });

  it("rejects connection add with a literal secret value", () => {
    expect(() =>
      parseCommand(["connection", "add", "jira", "--reference", "sk-ant-abcdefghijklmnop"]),
    ).toThrow(SecretValueRejectedError);
  });

  it("rejects connection add with an unknown provider", () => {
    expect(() =>
      parseCommand(["connection", "add", "bogus", "--reference", "env:X"]),
    ).toThrow(CliUsageError);
  });

  it("parses connection list/doctor/capabilities", () => {
    expect(parseCommand(["connection", "list"])).toEqual({ command: "connection-list", json: false });
    expect(parseCommand(["connection", "doctor", "conn-1"])).toEqual({
      command: "connection-doctor",
      connectionId: "conn-1",
      json: false,
    });
    expect(parseCommand(["connection", "capabilities", "conn-1"])).toEqual({
      command: "connection-capabilities",
      connectionId: "conn-1",
      json: false,
    });
  });

  it("parses trust review|approve|revoke", () => {
    expect(parseCommand(["trust", "review"])).toEqual({ command: "trust-review", json: false });
    expect(parseCommand(["trust", "approve", "deadbeef"])).toEqual({
      command: "trust-approve",
      digest: "deadbeef",
      json: false,
    });
    expect(parseCommand(["trust", "revoke", "tok-1"])).toEqual({
      command: "trust-revoke",
      tokenId: "tok-1",
      json: false,
    });
  });

  it("parses learn list|approve|reject|rollback", () => {
    expect(parseCommand(["learn", "list"])).toEqual({ command: "learn-list", json: false });
    expect(parseCommand(["learn", "approve", "p-1"])).toEqual({
      command: "learn-approve",
      proposalId: "p-1",
      json: false,
    });
    expect(parseCommand(["learn", "reject", "p-1"])).toEqual({
      command: "learn-reject",
      proposalId: "p-1",
      json: false,
    });
    expect(parseCommand(["learn", "rollback", "p-1"])).toEqual({
      command: "learn-rollback",
      proposalId: "p-1",
      json: false,
    });
  });

  it("parses upgrade and uninstall", () => {
    expect(parseCommand(["upgrade", "--dry-run"])).toEqual({
      command: "upgrade",
      dryRun: true,
      json: false,
    });
    expect(parseCommand(["uninstall", "--keep-state"])).toEqual({
      command: "uninstall",
      keepState: true,
      json: false,
    });
  });

  it("parses gateway mcp with no user-facing flags", () => {
    expect(parseCommand(["gateway", "mcp"])).toEqual({ command: "gateway-mcp" });
  });

  it("rejects gateway with an unknown sub-command", () => {
    expect(() => parseCommand(["gateway", "bogus"])).toThrow(CliUsageError);
  });

  it("parses no-argv / help / -h / --help as help", () => {
    expect(parseCommand([])).toEqual({ command: "help", json: false });
    expect(parseCommand(["help"])).toEqual({ command: "help", json: false });
    expect(parseCommand(["--help"])).toEqual({ command: "help", json: false });
    expect(parseCommand(["-h"])).toEqual({ command: "help", json: false });
    expect(parseCommand(["help", "doctor"])).toEqual({
      command: "help",
      json: false,
      topic: "doctor",
    });
  });

  it("rejects an unknown top-level command", () => {
    expect(() => parseCommand(["frobnicate"])).toThrow(CliUsageError);
  });

  it("rejects a malformed flag", () => {
    expect(() => parseCommand(["status", "--"])).toThrow(CliUsageError);
  });
});
