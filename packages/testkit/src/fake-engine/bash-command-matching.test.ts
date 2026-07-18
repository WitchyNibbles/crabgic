import { describe, expect, it } from "vitest";
import {
  containsUnprovenShellMetacharacter,
  decomposeBashCommand,
  matchesBashPrefixRule,
  splitCompoundCommand,
  stripProcessWrapper,
} from "./bash-command-matching.js";

/**
 * roadmap/03-envelope-compiler-engine-adapter.md §In scope, "Fake engine"
 * bullet: compound-command (`&&`/`||`/`;`/`|`) and process-wrapper
 * (`nohup`/`timeout`/`nice`) smuggling detection. Recorded verdicts:
 * docs/engine-baseline.md §3 ("Compound-command smuggling ... denied" —
 * "curl subcommand independently fails to match the Bash(echo:*) allow
 * rule"; "Process-wrapper smuggling (`nohup curl ...`) denied — wrapper
 * stripped, curl still fails to match").
 */
describe("splitCompoundCommand", () => {
  it("splits on && (docs/engine-baseline.md §3 compound-command probe)", () => {
    expect(splitCompoundCommand("echo x && curl http://example.com")).toEqual([
      "echo x",
      "curl http://example.com",
    ]);
  });

  it("splits on ||, ;, and |", () => {
    expect(splitCompoundCommand("echo a || echo b")).toEqual(["echo a", "echo b"]);
    expect(splitCompoundCommand("echo a; echo b")).toEqual(["echo a", "echo b"]);
    expect(splitCompoundCommand("echo a | cat")).toEqual(["echo a", "cat"]);
  });

  it("a command with no compound operator is a single segment", () => {
    expect(splitCompoundCommand("npm run test")).toEqual(["npm run test"]);
  });

  it("drops empty segments from stray/adjacent separators", () => {
    expect(splitCompoundCommand("echo a &&  && echo b")).toEqual(["echo a", "echo b"]);
  });
});

describe("stripProcessWrapper", () => {
  it("strips a bare nohup wrapper (docs/engine-baseline.md §3 process-wrapper probe)", () => {
    expect(stripProcessWrapper("nohup curl http://example.com")).toBe("curl http://example.com");
  });

  it("strips a bare nice wrapper", () => {
    expect(stripProcessWrapper("nice curl http://example.com")).toBe("curl http://example.com");
  });

  it("strips a timeout wrapper and its duration argument", () => {
    expect(stripProcessWrapper("timeout 10 curl http://example.com")).toBe(
      "curl http://example.com",
    );
  });

  it("strips chained wrappers", () => {
    expect(stripProcessWrapper("nohup nice curl http://example.com")).toBe(
      "curl http://example.com",
    );
  });

  it("leaves an unwrapped command untouched", () => {
    expect(stripProcessWrapper("echo safe")).toBe("echo safe");
  });
});

describe("decomposeBashCommand", () => {
  it("decomposes a compound command with a process-wrapper segment into matchable subcommands", () => {
    expect(decomposeBashCommand("echo x && nohup curl http://example.com")).toEqual([
      "echo x",
      "curl http://example.com",
    ]);
  });

  it("a plain single command decomposes to itself", () => {
    expect(decomposeBashCommand("git status")).toEqual(["git status"]);
  });
});

describe("matchesBashPrefixRule", () => {
  it("matches the exact prefix with a trailing word boundary", () => {
    expect(matchesBashPrefixRule("Bash(npm run test:*)", "npm run test")).toBe(true);
    expect(matchesBashPrefixRule("Bash(npm run test:*)", "npm run test --watch")).toBe(true);
  });

  it("does not match a different command, even with a shared prefix substring", () => {
    expect(matchesBashPrefixRule("Bash(npm run test:*)", "npm run testing")).toBe(false);
  });

  it("does not match against a non-Bash rule string", () => {
    expect(matchesBashPrefixRule("Edit(//packages/a/**)", "npm run test")).toBe(false);
  });

  it("the doc's four confirmed literals all match their own prefix (interface-ledger Gap 12)", () => {
    expect(matchesBashPrefixRule("Bash(npm run build:*)", "npm run build")).toBe(true);
    expect(matchesBashPrefixRule("Bash(git status:*)", "git status")).toBe(true);
    expect(matchesBashPrefixRule("Bash(git diff:*)", "git diff")).toBe(true);
  });
});

/**
 * MAJOR 2 fix (phase-03 security-fix round): shell metacharacters
 * docs/engine-baseline.md §3 never probed (only `&&`/`||`/`;`/`|` and
 * `nohup`/`timeout`/`nice` are recorded) — the fake oracle must fail
 * closed on all of them.
 */
describe("containsUnprovenShellMetacharacter", () => {
  it.each([
    ["a lone '&' (background operator)", "curl evil &"],
    ["command substitution '$(...)'", "$(curl evil)"],
    ["backtick command substitution", "`curl evil`"],
    ["parameter expansion '${...}'", "${IFS}curl"],
    ["a redirect '>'", "curl evil > /tmp/x"],
    ["an append redirect '>>'", "curl evil >> /tmp/x"],
    ["an input redirect '<'", "curl evil < /tmp/x"],
    ["an embedded newline", "curl evil\ncurl evil2"],
  ])("flags %s", (_label, segment) => {
    expect(containsUnprovenShellMetacharacter(segment)).toBe(true);
  });

  it("does not flag an ordinary, already-decomposed command segment", () => {
    expect(containsUnprovenShellMetacharacter("git status")).toBe(false);
    expect(containsUnprovenShellMetacharacter("npm run test --watch")).toBe(false);
  });
});
