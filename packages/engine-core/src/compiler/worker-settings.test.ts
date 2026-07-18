import { describe, expect, it } from "vitest";
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { toWorkerSettingsJson, toWorkerSdkOptions } from "./worker-settings.js";
import { emitPermissionProfile } from "./permission-profile.js";
import { emitSandboxProfile } from "./sandbox-profile.js";
import { buildEnvelopeFixture } from "./envelope-fixture.js";

/**
 * `toWorkerSettingsJson`/`toWorkerSdkOptions` tests (roadmap/03-envelope-
 * compiler-engine-adapter.md work item 3: "`WorkerSettingsJson` … and
 * mirrored `WorkerSdkOptions` … one compiled decision, two
 * serializations").
 */
describe("toWorkerSettingsJson / toWorkerSdkOptions — one compiled decision, two serializations", () => {
  const envelope = buildEnvelopeFixture({
    ownedPaths: ["packages/a/src"],
    commands: ["git status"],
  });
  const permissions = emitPermissionProfile(envelope);
  const sandbox = emitSandboxProfile(envelope);

  it("WorkerSettingsJson embeds the exact compiled permissions/sandbox decision", () => {
    const settingsJson = toWorkerSettingsJson(permissions, sandbox);
    expect(settingsJson.permissions).toEqual(permissions);
    expect(settingsJson.sandbox).toEqual(sandbox);
  });

  it("WorkerSdkOptions.allowedTools/disallowedTools mirror the SAME permissions.allow/deny arrays", () => {
    const sdkOptions = toWorkerSdkOptions(permissions);
    expect(sdkOptions.allowedTools).toEqual(permissions.allow);
    expect(sdkOptions.disallowedTools).toEqual(permissions.deny);
  });

  it("permissionMode is dontAsk", () => {
    expect(toWorkerSdkOptions(permissions).permissionMode).toBe("dontAsk");
  });

  it("settingSources is explicitly the empty array (roadmap/03 §Risks, §10 risk #3)", () => {
    expect(toWorkerSdkOptions(permissions).settingSources).toEqual([]);
  });

  it("strictMcpConfig is true", () => {
    expect(toWorkerSdkOptions(permissions).strictMcpConfig).toBe(true);
  });

  it("mcpServers is keyed by exactly GATEWAY_MCP_SERVER_NAME — no other server", () => {
    const sdkOptions = toWorkerSdkOptions(permissions);
    expect(Object.keys(sdkOptions.mcpServers)).toEqual([GATEWAY_MCP_SERVER_NAME]);
  });
});
