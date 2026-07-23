// Stdio-boot fixture (roadmap/16-gateway-core.md §Test plan, Integration:
// "`gateway mcp` boot listing exactly the native tool set over stdio to a
// stub MCP client, plus a test-registered extra tool proving the
// registration API is genuinely extensible"). Plain .mjs, matching this
// repo's established kill-harness-fixture convention — imports this
// package's own already-built dist output directly, mirroring what 09's
// real `gateway mcp` argv shim will do at its own entry point.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createJournalStore } from "@eo/journal";
import {
  buildNativeToolRegistry,
  buildGatewayMcpServer,
  connectGatewayMcpServer,
  InMemoryExternalConnectionStore,
  ProviderRegistry,
} from "@eo/gateway";

const journalDir = process.env.EO_FIXTURE_JOURNAL_DIR;
const registerExtraTool = process.env.EO_FIXTURE_REGISTER_EXTRA_TOOL === "1";

const journal = createJournalStore({ journalDir });
const connections = new InMemoryExternalConnectionStore();
const providers = new ProviderRegistry();

const registry = buildNativeToolRegistry({
  connections,
  providers,
  journal,
  mutationApplyClients: new ProviderRegistry(),
  supervisorSocketPath: "/nonexistent.sock",
});

if (registerExtraTool) {
  registry.register({
    name: "project.inspect",
    description: "an 11-owned tool, registered independently at its own build time",
    inputSchema: {},
    handler: async () => ({ content: [{ type: "text", text: "{}" }] }),
  });
}

// Uses this package's own exported wiring (`buildGatewayMcpServer` +
// `connectGatewayMcpServer`) rather than re-deriving the McpServer
// adaptation inline — the exact call sequence 09's real `gateway mcp`
// argv shim makes at its own entry point, and what exercises this
// module's own callback body under test.
const server = buildGatewayMcpServer(registry);
await connectGatewayMcpServer(server, new StdioServerTransport());
