import { describe, expect, it } from "vitest";
import { createFakeSandboxRunner } from "./fake-sandbox-runner.js";
import { DEFAULT_SANDBOX_POLICY } from "./types.js";

describe("createFakeSandboxRunner", () => {
  it("denies network egress under an empty allowedDomains policy (roadmap/12's own named security test)", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run(
      [{ type: "network", target: "evil.example.com" }],
      DEFAULT_SANDBOX_POLICY,
    );
    expect(result.deniedOperations).toEqual(["network:evil.example.com"]);
  });

  it("denies a read of ~/.ssh (roadmap/12's own named security test)", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run([{ type: "read", target: "~/.ssh/id_rsa" }], DEFAULT_SANDBOX_POLICY);
    expect(result.deniedOperations).toEqual(["read:~/.ssh/id_rsa"]);
  });

  it("allows network access to an explicitly allow-listed domain", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run([{ type: "network", target: "api.example.com" }], {
      allowedDomains: ["api.example.com"],
      denyReadPaths: [],
    });
    expect(result.deniedOperations).toEqual([]);
  });

  it("allows a read outside every deny-listed path", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run(
      [{ type: "read", target: "./workdir/data.json" }],
      DEFAULT_SANDBOX_POLICY,
    );
    expect(result.deniedOperations).toEqual([]);
  });

  /**
   * Adversarial-review finding (MEDIUM, confirmed fail-open): `passed` used
   * to be hardcoded `true` regardless of `deniedOperations` — the stand-in
   * for an actual sandbox "gate" verdict, not a real one. A real policy
   * evaluator FAILS the self-test when it declares an operation the policy
   * denies (roadmap/12's own security test: network egress / `~/.ssh` read
   * "must be denied" — denial must be a REJECTION, not merely recorded).
   */
  it("reports passed:false when the declared plan includes ANY denied operation (fail-closed, not merely recorded)", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run(
      [{ type: "network", target: "evil.example.com" }],
      DEFAULT_SANDBOX_POLICY,
    );
    expect(result.passed).toBe(false);
  });

  it("reports passed:false for a denied ~/.ssh read too", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run([{ type: "read", target: "~/.ssh/id_rsa" }], DEFAULT_SANDBOX_POLICY);
    expect(result.passed).toBe(false);
  });

  it("reports passed:true when every declared operation is allowed", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run([{ type: "network", target: "api.example.com" }], {
      allowedDomains: ["api.example.com"],
      denyReadPaths: [],
    });
    expect(result.passed).toBe(true);
  });

  it("a benign candidate declaring no operations at all is denied nothing and passes", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run([], DEFAULT_SANDBOX_POLICY);
    expect(result.deniedOperations).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("reports passed:false when even ONE of several declared operations is denied (mixed allowed+denied)", () => {
    const runner = createFakeSandboxRunner();
    const result = runner.run(
      [
        { type: "read", target: "./workdir/data.json" }, // allowed
        { type: "network", target: "evil.example.com" }, // denied
      ],
      DEFAULT_SANDBOX_POLICY,
    );
    expect(result.passed).toBe(false);
    expect(result.deniedOperations).toEqual(["network:evil.example.com"]);
  });
});
