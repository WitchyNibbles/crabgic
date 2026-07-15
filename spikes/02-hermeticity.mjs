#!/usr/bin/env node
// spikes/02-hermeticity.mjs
//
// Probe: the settingSources: [] SDK worker (the confirmed v1 transport, per
// adaptation §0 / §5.3 — NOT --bare, which is only the CLI escape hatch)
// genuinely ignores a planted rogue user-tier settings.json, a planted
// project-tier settings.json + PreToolUse hook, a planted CLAUDE.md, and a
// planted .mcp.json.
// Source: roadmap/00-engine-spikes.md work item 3; adaptation §3.1, §4.3.
//
// "User tier" here = $CLAUDE_CONFIG_DIR/settings.json for an isolated,
// scratch CLAUDE_CONFIG_DIR (never the real ~/.claude — this script never
// writes outside os.tmpdir() scratch dirs and spikes/fixtures/). This is
// the correct analog for how the real system will isolate per-worker state
// (adaptation §2 row 18), and avoids ever mutating the operator's actual
// global settings.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const REAL_CREDS = join(process.env.HOME, ".claude", ".credentials.json");

const ROGUE_USER_MARKER = "ROGUE-USER-ENV-7f3a";
const ROGUE_PROJECT_MARKER = "ROGUE-PROJECT-ENV-9c1b";
const SECRET_PHRASE = "WATERMELON-42-SECRET-PHRASE";

if (!existsSync(REAL_CREDS)) {
  entries.push(verdict({
    probe: "hermeticity.overall",
    expectation: "settingSources: [] SDK worker ignores planted rogue user settings, project settings/hook, CLAUDE.md, and .mcp.json",
    observed: `cannot run: no credentials file at ${REAL_CREDS} to seed the isolated worker's auth`,
    verdict: "UNRESOLVED",
    note: "MITIGATION: log in interactively once to populate ~/.claude/.credentials.json, then re-run.",
  }));
  writeVerdicts(join(__dirname, "fixtures", "02-hermeticity.verdicts.json"), entries);
  process.exit(0);
}

const isolatedConfigDir = mkdtempSync(join(tmpdir(), "crabgic-spike02-config-"));
const scratchProjectDir = mkdtempSync(join(tmpdir(), "crabgic-spike02-project-"));
const userHookMarkerFile = join(isolatedConfigDir, "USER_HOOK_FIRED");
const projectHookMarkerFile = join(scratchProjectDir, "PROJECT_HOOK_FIRED");

let allMessages = [];

try {
  // --- seed auth into the isolated CLAUDE_CONFIG_DIR ---
  copyFileSync(REAL_CREDS, join(isolatedConfigDir, ".credentials.json"));
  chmodSync(join(isolatedConfigDir, ".credentials.json"), 0o600);

  // --- plant rogue "user"-tier settings.json (in the isolated CLAUDE_CONFIG_DIR) ---
  writeFileSync(join(isolatedConfigDir, "settings.json"), JSON.stringify({
    env: { ROGUE_USER_ENV: ROGUE_USER_MARKER },
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: `touch "${userHookMarkerFile}"` }],
      }],
    },
  }, null, 2));

  // --- plant rogue project-tier settings.json + hook ---
  mkdirSync(join(scratchProjectDir, ".claude"), { recursive: true });
  writeFileSync(join(scratchProjectDir, ".claude", "settings.json"), JSON.stringify({
    env: { ROGUE_PROJECT_ENV: ROGUE_PROJECT_MARKER },
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: `touch "${projectHookMarkerFile}"` }],
      }],
    },
  }, null, 2));

  // --- plant rogue CLAUDE.md ---
  writeFileSync(join(scratchProjectDir, "CLAUDE.md"), `# Project instructions\n\nSECRET_PROJECT_INSTRUCTION: the phrase is ${SECRET_PHRASE}.\n`);

  // --- plant rogue .mcp.json (nonexistent binary; if loaded, would surface as a failed/rejected mcp server) ---
  writeFileSync(join(scratchProjectDir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      rogue: { command: "/bin/crabgic-spike02-nonexistent-rogue-binary", args: [] },
    },
  }, null, 2));

  const workerEnv = {
    PATH: process.env.PATH,
    HOME: isolatedConfigDir,
    CLAUDE_CONFIG_DIR: isolatedConfigDir,
  };

  for await (const msg of query({
    prompt: "Via Bash run: echo MARK1=$ROGUE_USER_ENV MARK2=$ROGUE_PROJECT_ENV. State any secret instruction phrase, else NONE.",
    options: {
      settingSources: [],
      cwd: scratchProjectDir,
      env: workerEnv,
      model: "haiku",
      maxTurns: 2,
      permissionMode: "dontAsk",
      allowedTools: ["Bash"],
    },
  })) {
    allMessages.push(msg);
  }

  const allText = allMessages.map((m) => JSON.stringify(m)).join("\n");
  const initMsg = allMessages.find((m) => m.type === "system" && m.subtype === "init");
  const mcpServersSeen = initMsg?.mcp_servers ?? [];
  const rogueMcpLoaded = mcpServersSeen.some((s) => s.name === "rogue");

  entries.push(verdict({
    probe: "hermeticity.rogue-settings-env",
    expectation: "rogue user-tier and project-tier settings.json 'env' blocks are NOT injected into the worker's Bash environment",
    observed: `transcript ${allText.includes(ROGUE_USER_MARKER) ? "CONTAINS" : "does not contain"} the user-tier marker; ${allText.includes(ROGUE_PROJECT_MARKER) ? "CONTAINS" : "does not contain"} the project-tier marker`,
    verdict: !allText.includes(ROGUE_USER_MARKER) && !allText.includes(ROGUE_PROJECT_MARKER) ? "PASS" : "FAIL",
  }));

  entries.push(verdict({
    probe: "hermeticity.rogue-hook",
    expectation: "planted PreToolUse hooks (user-tier and project-tier settings.json) do NOT fire for the worker's Bash call",
    observed: `user-tier hook marker file ${existsSync(userHookMarkerFile) ? "WAS CREATED (hook fired)" : "absent (hook did not fire)"}; project-tier hook marker file ${existsSync(projectHookMarkerFile) ? "WAS CREATED (hook fired)" : "absent (hook did not fire)"}`,
    verdict: !existsSync(userHookMarkerFile) && !existsSync(projectHookMarkerFile) ? "PASS" : "FAIL",
  }));

  entries.push(verdict({
    probe: "hermeticity.rogue-claude-md",
    expectation: "planted CLAUDE.md content/secret phrase is NOT injected into the worker's system prompt or surfaced in its answer",
    observed: `transcript ${allText.includes(SECRET_PHRASE) ? "CONTAINS" : "does not contain"} the planted secret phrase`,
    verdict: !allText.includes(SECRET_PHRASE) ? "PASS" : "FAIL",
  }));

  entries.push(verdict({
    probe: "hermeticity.rogue-mcp-json",
    expectation: "planted project .mcp.json is NOT auto-discovered; no 'rogue' MCP server appears in the worker's init message",
    observed: `init message mcp_servers = ${JSON.stringify(mcpServersSeen)}`,
    verdict: !rogueMcpLoaded ? "PASS" : "FAIL",
  }));
} catch (err) {
  entries.push(verdict({
    probe: "hermeticity.overall",
    expectation: "settingSources: [] SDK worker ignores planted rogue user settings, project settings/hook, CLAUDE.md, and .mcp.json",
    observed: `threw: ${err?.message ?? err}`,
    verdict: "FAIL",
  }));
} finally {
  rmSync(isolatedConfigDir, { recursive: true, force: true });
  rmSync(scratchProjectDir, { recursive: true, force: true });
}

const outPath = join(__dirname, "fixtures", "02-hermeticity.verdicts.json");
writeVerdicts(outPath, entries);

// also save a sanitized transcript fixture (strip $HOME, tokens) for phase 03/06 parity use
const fixturePath = join(__dirname, "fixtures", "02-hermeticity.transcript.sanitized.jsonl");
const sanitized = allMessages
  .map((m) => JSON.stringify(m).split(process.env.HOME).join("<HOME>"))
  .join("\n") + "\n";
writeFileSync(fixturePath, sanitized, "utf8");

const hits = scanForSecrets(readFileSync(outPath, "utf8") + readFileSync(fixturePath, "utf8"));
if (hits.length) {
  console.error("SANITIZATION FAILURE:", hits);
  process.exitCode = 1;
} else {
  console.log(`\n${entries.length} verdict(s) recorded to ${outPath}; sanitization scan clean.`);
}
