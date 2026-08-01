import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExternalConnectionSchema, GATEWAY_MCP_SERVER_NAME } from "@crabgic/contracts";
import { buildSimulatedWorkerMcpServers } from "./upstream-mcp-client-policy.js";

/**
 * TRIPWIRE — the optional upstream-MCP-client wrap must stay structurally
 * unenableable until its quarantine precondition is settled.
 *
 * `roadmap/16-gateway-core.md` §Risks records the open question: whether an
 * upstream provider MCP server this gateway acts as a client to must first pass
 * phase 12's capability-quarantine pipeline. 16 and 12 each assumed the other
 * addressed it, so it is addressed by neither. `docs/threat-model.md` §5/§6
 * carries the same open item.
 *
 * The reason that is currently harmless is NOT "the flag defaults to false" —
 * a default is one line away from being changed. It is that there is no way to
 * turn it on at all:
 *
 *   1. `UpstreamMcpClientPolicyStore` is never constructed in production code.
 *      Its only callers are its own unit tests.
 *   2. No MCP *client* exists anywhere in shipped source. The gateway imports
 *      `@modelcontextprotocol/sdk`'s SERVER surface only.
 *   3. `ExternalConnectionSchema` is `.strict()` and has no field for the flag,
 *      so a config file declaring one is REJECTED, not ignored.
 *   4. No environment variable reaches it.
 *   5. `buildSimulatedWorkerMcpServers()` takes no policy argument, so no
 *      second server can become worker-visible whatever the policy says.
 *
 * Each numbered fact is asserted below. Together they mean that enabling this
 * feature requires writing new code AND a coordinated phase-02 schema change —
 * at which point this test fails, and whoever is doing that has to go settle
 * the 16/12 quarantine ruling first (`roadmap/16-gateway-core.md` §Risks
 * records the precondition).
 *
 * READ-ONLY source scan, in the style of
 * `packages/learning/src/red-team/no-mcp-tool-family.redteam.test.ts`:
 * `readFileSync` over source text is not an import, and this suite adds no
 * module-graph edge.
 */
const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * NO EXEMPTIONS, deliberately.
 *
 * An earlier draft exempted the policy module and the package index on the
 * theory that they must be allowed to NAME the store. They don't need it: the
 * patterns below match a CONSTRUCTION (`new UpstreamMcpClientPolicyStore`) and
 * a CALL (`.setEnabled(`), and a class declaration, a method declaration and a
 * re-export are none of those — verified by grepping both files for the exact
 * patterns and finding nothing. Worse, the exemption put a blind spot on the
 * one file where enablement code is most likely to be written: seeding a
 * module-scope `new UpstreamMcpClientPolicyStore()` + `setEnabled` into
 * `upstream-mcp-client-policy.ts` slipped past fact (1) entirely while the
 * exemption stood.
 */
function collectProductionSources(dir: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") {
        continue;
      }
      files.push(...collectProductionSources(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      files.push(entryPath);
    }
  }
  return files;
}

/** Every production source line matching `pattern`, as `relativePath: line` pairs. */
function scanProductionSources(pattern: RegExp): readonly string[] {
  const hits: string[] = [];
  for (const filePath of collectProductionSources(PACKAGES_DIR)) {
    const relativePath = relative(PACKAGES_DIR, filePath);
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      if (pattern.test(line)) hits.push(`${relativePath}: ${line.trim()}`);
    }
  }
  return hits;
}

const ENABLEMENT_PATTERN = /new\s+UpstreamMcpClientPolicyStore|\.setEnabled\s*\(/;
const MCP_CLIENT_IMPORT_PATTERN = /@modelcontextprotocol\/sdk\/client/;

describe("tripwire — the upstream-MCP-client wrap is structurally unenableable", () => {
  it("the scan is not vacuous: the target tree resolves and holds many production sources", () => {
    expect(statSync(PACKAGES_DIR).isDirectory()).toBe(true);
    expect(collectProductionSources(PACKAGES_DIR).length).toBeGreaterThan(100);
  });

  it("the scanner detects the violations it claims to detect (failing-first, against synthetic text)", () => {
    // The scan above is only worth anything if these patterns actually match
    // the code shapes that would enable the feature.
    expect(ENABLEMENT_PATTERN.test("const store = new UpstreamMcpClientPolicyStore();")).toBe(true);
    expect(ENABLEMENT_PATTERN.test("policy.setEnabled(connection.id, true);")).toBe(true);
    expect(
      MCP_CLIENT_IMPORT_PATTERN.test(
        'import { Client } from "@modelcontextprotocol/sdk/client/index.js";',
      ),
    ).toBe(true);
    // ...and do not match the server surface the gateway legitimately uses.
    expect(
      MCP_CLIENT_IMPORT_PATTERN.test(
        'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      ),
    ).toBe(false);
  });

  it("(1) no production source constructs the policy store or flips the flag", () => {
    expect(scanProductionSources(ENABLEMENT_PATTERN)).toEqual([]);
  });

  it("(2) no production source imports an MCP client — the gateway is a server, never a client", () => {
    expect(scanProductionSources(MCP_CLIENT_IMPORT_PATTERN)).toEqual([]);
  });

  it("(3) ExternalConnectionSchema is strict and REJECTS an upstream-MCP flag rather than ignoring it", () => {
    const valid = {
      schemaVersion: 1,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      allowedRedirectOrigins: ["https://grafana.example.com"],
      allowedResources: ["dashboard"],
      allowedActions: ["read"],
      discoveryTtlSeconds: 900,
      secretRef: { backend: "env" as const, variable: "GRAFANA_TOKEN" },
    };
    // Sanity: the fixture without the flag is a legal connection, so the
    // rejection below is attributable to the flag and nothing else.
    expect(ExternalConnectionSchema.safeParse(valid).success).toBe(true);

    for (const field of ["upstreamMcpEnabled", "upstreamMcpClient", "mcpClientEnabled"]) {
      const withFlag = { ...valid, [field]: true };
      expect(ExternalConnectionSchema.safeParse(withFlag).success).toBe(false);
    }
  });

  it("(4) no environment variable reaches the flag", () => {
    expect(scanProductionSources(/process\.env\S*(?:UPSTREAM|MCP_CLIENT)/i)).toEqual([]);
    expect(scanProductionSources(/UPSTREAM_MCP|MCP_CLIENT_ENABLED/)).toEqual([]);
  });

  it("(5) buildSimulatedWorkerMcpServers takes no policy argument and yields exactly one server", () => {
    // Arity zero is the structural half: a function that accepts nothing cannot
    // be handed a policy, so no caller can make the worker-visible set depend on
    // whether some connection's flag is set. Threading a policy in means adding
    // a parameter, which trips this.
    expect(buildSimulatedWorkerMcpServers.length).toBe(0);

    // ...and the output half, so widening the body rather than the signature —
    // reading a module-scope policy, say — is caught too.
    expect(Object.keys(buildSimulatedWorkerMcpServers())).toEqual([GATEWAY_MCP_SERVER_NAME]);
  });
});
