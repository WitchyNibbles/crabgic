#!/usr/bin/env node
// spikes/09-human-interaction-tool.mjs
//
// Probes the engine's HUMAN-INTERACTION tool surface, for the manager
// operating protocol (roadmap/10 + roadmap/11): the manager session is
// required to ask irreducible product decisions through the engine's
// structured question tool rather than as prose, and workers must be
// structurally incapable of asking a human anything at all.
//
// Two distinct claims, with deliberately different evidentiary strength.
// Read the strength difference before citing either:
//
//   CLAIM A (scripted here, load-bearing, SECURITY-relevant):
//     `AskUserQuestion` is ABSENT from the headless tool catalog, on BOTH
//     transports, under a sanitized env. This is what makes "a worker can
//     never block waiting on a human" true by construction rather than by
//     policy — headless workers have no such tool to call. Probes A/B/C.
//
//   CLAIM B (NOT scripted here, UX-relevant only):
//     `AskUserQuestion` is PRESENT in an INTERACTIVE (TUI) session, which
//     is what the manager session runs as. This script CANNOT capture that
//     catalog: interactive mode emits no `system/init` line (that is a
//     `--print`/stream-json surface), and two attempts at driving a pty
//     with `--debug api --debug-file` produced no request payload — the
//     `api` debug filter does not dump the outbound `tools` array. Probe D
//     therefore records UNRESOLVED with an explicit MITIGATION, and the
//     protocol text that depends on it is written to DEGRADE GRACEFULLY
//     (fall back to one consolidated prose question) precisely so that no
//     shipped behavior rests on an unverified engine fact.
//
// Because of that split, a FAIL on A/B/C is a real regression (a worker
// could ask a human, or hang doing so); D staying UNRESOLVED is a known,
// documented gap, not a failure.

import { mkdtempSync, rmSync, copyFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaude } from "./lib/cli.mjs";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const REAL_CREDS = join(process.env.HOME, ".claude", ".credentials.json");

/** The human-interaction tool this probe is about. */
const QUESTION_TOOL = "AskUserQuestion";

/**
 * The 29-tool headless catalog recorded in docs/engine-baseline.md §4.4,
 * byte-identical at 2.1.210 and 2.1.218. Re-asserted here so that a catalog
 * drift shows up as a FAIL on THIS probe too, rather than silently changing
 * what "AskUserQuestion is absent" is absent *from*.
 */
const BASELINE_CATALOG_4_4 = [
  "Bash", "CronCreate", "CronDelete", "CronList", "DesignSync", "Edit",
  "EnterWorktree", "ExitWorktree", "Monitor", "NotebookEdit", "PushNotification",
  "Read", "RemoteTrigger", "ReportFindings", "ScheduleWakeup", "SendMessage",
  "Skill", "Task", "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop",
  "TaskUpdate", "ToolSearch", "WebFetch", "WebSearch", "Workflow", "Write",
];

if (!existsSync(REAL_CREDS)) {
  entries.push(verdict({
    probe: "human-interaction-tool.overall",
    expectation: "human-interaction tool-surface probes run against a live engine",
    observed: `cannot run: no credentials file at ${REAL_CREDS}`,
    verdict: "UNRESOLVED",
    note: "MITIGATION: log in interactively once to populate ~/.claude/.credentials.json, then re-run.",
  }));
  writeVerdicts(join(__dirname, "fixtures", "09-human-interaction-tool.verdicts.json"), entries);
  process.exit(0);
}

const isolatedConfigDir = mkdtempSync(join(tmpdir(), "crabgic-spike09-config-"));
const isolatedTmp = mkdtempSync(join(tmpdir(), "crabgic-spike09-tmp-"));
copyFileSync(REAL_CREDS, join(isolatedConfigDir, ".credentials.json"));
chmodSync(join(isolatedConfigDir, ".credentials.json"), 0o600);

const allowlistedEnv = {
  PATH: process.env.PATH,
  HOME: isolatedConfigDir,
  TMPDIR: isolatedTmp,
  CLAUDE_CONFIG_DIR: isolatedConfigDir,
};

const catalogs = {};

function sortedOrNull(tools) {
  return Array.isArray(tools) ? [...tools].sort() : null;
}

try {
  // --- A: SDK transport (the transport phase 06 actually spawns workers on) ---
  let sdkInit = null;
  for await (const msg of query({
    prompt: "Reply with just: ok",
    options: {
      settingSources: [],
      cwd: isolatedConfigDir,
      env: allowlistedEnv,
      model: "haiku",
      maxTurns: 1,
    },
  })) {
    if (msg.type === "system" && msg.subtype === "init") sdkInit = msg;
  }
  catalogs.sdk = {
    transport: "sdk",
    tools: sdkInit?.tools ?? null,
    claude_code_version: sdkInit?.claude_code_version ?? null,
  };

  // --- B: CLI transport, headless ---
  const rCli = await runClaude([
    "-p", "Reply with just: ok",
    "--model", "haiku",
    "--output-format", "stream-json", "--verbose",
    "--setting-sources", "",
  ], { env: allowlistedEnv, cwd: isolatedConfigDir, timeoutMs: 45000 });
  let cliInit = null;
  for (const line of rCli.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === "system" && j.subtype === "init") { cliInit = j; break; }
    } catch { /* non-JSON progress line */ }
  }
  catalogs.cli = {
    transport: "cli",
    tools: cliInit?.tools ?? null,
    claude_code_version: cliInit?.claude_code_version ?? null,
    exit: rCli.code,
  };

  const sdkHas = (catalogs.sdk.tools ?? []).includes(QUESTION_TOOL);
  const cliHas = (catalogs.cli.tools ?? []).includes(QUESTION_TOOL);
  const bothCaptured = Array.isArray(catalogs.sdk.tools) && Array.isArray(catalogs.cli.tools);

  entries.push(verdict({
    probe: "human-interaction-tool.absent-headless-sdk",
    expectation: `the headless SDK tool catalog does NOT contain ${QUESTION_TOOL} — a worker must be structurally unable to ask a human anything`,
    observed:
      `sdk tools (${catalogs.sdk.tools?.length}): ${JSON.stringify(catalogs.sdk.tools)}; ` +
      `${QUESTION_TOOL} present=${sdkHas}; engine=${catalogs.sdk.claude_code_version}`,
    verdict: !Array.isArray(catalogs.sdk.tools) ? "UNRESOLVED" : sdkHas ? "FAIL" : "PASS",
    ...(sdkHas
      ? { note: `REGRESSION: a headless worker can now reach ${QUESTION_TOOL}. The worker permission profile's allow-list keeps it unreachable in practice (baseline §3: unlisted tools are auto-denied), but "workers cannot ask humans" stops being true BY CONSTRUCTION and becomes policy-dependent. Re-check phase 06's profile before shipping.` }
      : {}),
  }));

  entries.push(verdict({
    probe: "human-interaction-tool.absent-headless-cli",
    expectation: `the headless CLI tool catalog does NOT contain ${QUESTION_TOOL} either — absence is an engine property of headless mode, not an SDK-transport artifact`,
    observed:
      `cli tools (${catalogs.cli.tools?.length}): ${JSON.stringify(catalogs.cli.tools)}; ` +
      `${QUESTION_TOOL} present=${cliHas}; engine=${catalogs.cli.claude_code_version}; exit=${catalogs.cli.exit}`,
    verdict: !Array.isArray(catalogs.cli.tools) ? "UNRESOLVED" : cliHas ? "FAIL" : "PASS",
  }));

  // --- C: catalog-drift guard against the baseline's own recorded list ---
  const sdkSorted = sortedOrNull(catalogs.sdk.tools);
  const cliSorted = sortedOrNull(catalogs.cli.tools);
  const baselineSorted = [...BASELINE_CATALOG_4_4].sort();
  const sdkMatches = JSON.stringify(sdkSorted) === JSON.stringify(baselineSorted);
  const cliMatches = JSON.stringify(cliSorted) === JSON.stringify(baselineSorted);

  entries.push(verdict({
    probe: "human-interaction-tool.catalog-matches-baseline-4-4",
    expectation:
      "the headless catalog still equals the 29-tool list docs/engine-baseline.md §4.4 recorded (as a set) — so the absence asserted above is absence from a KNOWN catalog, not from a drifted one",
    observed:
      `sdk matches §4.4 set=${sdkMatches}; cli matches §4.4 set=${cliMatches}; ` +
      (sdkMatches && cliMatches
        ? `both equal the recorded 29-tool list`
        : `sdk_only=${JSON.stringify((sdkSorted ?? []).filter((t) => !baselineSorted.includes(t)))}, ` +
          `missing_from_sdk=${JSON.stringify(baselineSorted.filter((t) => !(sdkSorted ?? []).includes(t)))}, ` +
          `cli_only=${JSON.stringify((cliSorted ?? []).filter((t) => !baselineSorted.includes(t)))}, ` +
          `missing_from_cli=${JSON.stringify(baselineSorted.filter((t) => !(cliSorted ?? []).includes(t)))}`),
    verdict: !bothCaptured ? "UNRESOLVED" : sdkMatches && cliMatches ? "PASS" : "FAIL",
    ...(bothCaptured && (!sdkMatches || !cliMatches)
      ? { note: "§10 baseline-invalidating event: the tracked tool catalog changed. Narrow the accepted version range at the version where the delta first appears before trusting any catalog-derived fact." }
      : {}),
  }));

  // --- D: the interactive half, deliberately NOT scripted. See header. ---
  entries.push(verdict({
    probe: "human-interaction-tool.present-interactive",
    expectation: `${QUESTION_TOOL} IS present in an INTERACTIVE (TUI) session, which is what the manager session runs as`,
    observed:
      "NOT CAPTURED BY THIS SCRIPT. Interactive mode emits no `system/init` line (that is a --print/stream-json surface), so the technique probes A/B use does not apply. " +
      "Two bounded attempts at driving a pty (`script -qec claude --debug api --debug-file ...`, once with the prompt as a positional arg and once submitting via a `\\r` on stdin) both produced a debug log with no outbound request payload: the `api` debug filter does not dump the `tools` array. " +
      "A third data point exists but is NOT a fixture: in a live interactive Claude Code session on this host at engine 2.1.220, the tool is present and its input schema carries `questions[]` with `question`/`header`/`options[]`/`multiSelect`, options carrying `label`/`description`/optional `preview`, plus a top-level `annotations` map used to return the user's free-text notes per question. That is a first-party in-session observation, recorded in docs/engine-baseline.md, NOT committed evidence produced by this script.",
    verdict: "UNRESOLVED",
    note:
      "MITIGATION (non-blocking): capture the interactive catalog properly before it is ever load-bearing — e.g. a pty harness that reads the TUI's own tool-list surface, or an engine build that logs the request payload under a debug filter. " +
      "NOT blocking today: the manager protocol that uses this tool is written to degrade gracefully (fall back to a single consolidated prose question when the tool is absent), so no shipped behavior depends on this probe resolving PASS.",
  }));

  const fixturePath = join(__dirname, "fixtures", "09-human-interaction-tool.catalogs.sanitized.json");
  const payload = JSON.stringify({ catalogs, baselineCatalog: BASELINE_CATALOG_4_4 }, null, 2) + "\n";
  const hits = scanForSecrets(payload);
  if (hits.length > 0) {
    entries.push(verdict({
      probe: "human-interaction-tool.fixture-sanitized",
      expectation: "no token-shaped or $HOME-path content is written to the committed fixture",
      observed: `secret-scan hits: ${JSON.stringify(hits)} — fixture NOT written`,
      verdict: "FAIL",
    }));
  } else {
    writeVerdicts(fixturePath, JSON.parse(payload));
  }
} finally {
  rmSync(isolatedConfigDir, { recursive: true, force: true });
  rmSync(isolatedTmp, { recursive: true, force: true });
}

writeVerdicts(join(__dirname, "fixtures", "09-human-interaction-tool.verdicts.json"), entries);

const failed = entries.filter((e) => e.verdict === "FAIL");
console.log(`\n${entries.length} verdicts, ${failed.length} FAIL`);
process.exitCode = failed.length > 0 ? 1 : 0;
