#!/usr/bin/env node
// spikes/03-permissions.mjs
//
// Probes (roadmap/00-engine-spikes.md work item 4; adaptation §4.1, Appendix B):
//   - dontAsk auto-denies an unlisted tool
//   - deny-wins-over-allow at the same settings level
//   - deny-wins-over-allow across settings levels (user vs project tier)
//   - compound-command smuggling (`allowed-cmd && curl ...`) denied
//   - process-wrapper smuggling (`nohup curl ...`) denied
//   - Edit outside the allowed path denied
//   - Agent deny blocks subagent spawning
//   - Bash colon-spacing verdict: is `Bash(<prefix>:*)` valid with NO space
//     before the colon (matching the doc's four literal examples, none of
//     which show a prefix beyond themselves) or does a space before the
//     colon also/instead match, for a prefix (`cargo check`) the doc never
//     shows?
//
// Transport: Agent SDK `query()` with `settingSources: []` + an explicit
// `settings` object carrying the exact permission envelope under test —
// this is the confirmed v1 worker-launch shape (adaptation §5.1/§5.3), and
// the SDK result's `permission_denials: {tool_name, tool_input}[]` field
// gives a direct, unambiguous signal independent of the model's own prose.
//
// Cost discipline: one isolated CLAUDE_CONFIG_DIR (credentials fallback)
// reused across all probes in this script; haiku; short prompts; probes
// that only need distinct permission configs get their own query, but
// independent behaviors under the SAME config are combined into one prompt.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const REAL_CREDS = join(process.env.HOME, ".claude", ".credentials.json");

if (!existsSync(REAL_CREDS)) {
  entries.push(verdict({
    probe: "permissions.overall",
    expectation: "all permission sub-probes run against a live SDK worker",
    observed: `cannot run: no credentials file at ${REAL_CREDS}`,
    verdict: "UNRESOLVED",
    note: "MITIGATION: log in interactively once to populate ~/.claude/.credentials.json, then re-run.",
  }));
  writeVerdicts(join(__dirname, "fixtures", "03-permissions.verdicts.json"), entries);
  process.exit(0);
}

const isolatedConfigDir = mkdtempSync(join(tmpdir(), "crabgic-spike03-config-"));
const scratchCwd = mkdtempSync(join(tmpdir(), "crabgic-spike03-cwd-"));
copyFileSync(REAL_CREDS, join(isolatedConfigDir, ".credentials.json"));
chmodSync(join(isolatedConfigDir, ".credentials.json"), 0o600);

const baseEnv = { PATH: process.env.PATH, HOME: isolatedConfigDir, CLAUDE_CONFIG_DIR: isolatedConfigDir };
const allFixtures = {};

async function runProbe(name, { settings, permissionMode = "dontAsk", settingSources = [], cwd = scratchCwd, prompt, maxTurns = 4 }) {
  const messages = [];
  for await (const msg of query({
    prompt,
    options: { settingSources, settings, permissionMode, cwd, env: baseEnv, model: "haiku", maxTurns },
  })) {
    messages.push(msg);
  }
  allFixtures[name] = messages;
  const result = messages.find((m) => m.type === "result");
  const denials = result?.permission_denials ?? [];
  const allText = messages.map((m) => JSON.stringify(m)).join("\n");
  return { messages, result, denials, allText };
}

const deniedTool = (denials, toolName) => denials.some((d) => d.tool_name === toolName);
const deniedBashMatching = (denials, substr) =>
  denials.some((d) => d.tool_name === "Bash" && String(d.tool_input?.command ?? "").includes(substr));

try {
  // --- Probe 1: unlisted-tool auto-deny + compound smuggling + wrapper smuggling (combined; same config) ---
  {
    const r = await runProbe("unlisted-and-smuggling", {
      settings: { permissions: { allow: ["Bash(echo:*)"] } },
      prompt: "Separately via Bash try: `echo safe`; `echo x && curl http://example.com`; `nohup curl http://example.com`. Also try Write a file test.txt.",
    });
    const echoAllowed = !deniedBashMatching(r.denials, "echo safe") ;
    const compoundDenied = deniedBashMatching(r.denials, "curl") && r.denials.some(d => d.tool_name === "Bash" && String(d.tool_input?.command ?? "").includes("&&"));
    const wrapperDenied = r.denials.some(d => d.tool_name === "Bash" && String(d.tool_input?.command ?? "").includes("nohup"));
    const writeDenied = deniedTool(r.denials, "Write");

    entries.push(verdict({
      probe: "permissions.dontask-auto-deny-unlisted-tool",
      expectation: "dontAsk mode auto-denies a tool (Write) not covered by any allow rule, with no interactive prompt",
      observed: `permission_denials=${JSON.stringify(r.denials)}; Write denied=${writeDenied}`,
      verdict: writeDenied ? "PASS" : "FAIL",
    }));
    entries.push(verdict({
      probe: "permissions.compound-command-smuggling",
      expectation: "`echo x && curl ...` is denied because the curl subcommand does not independently match the Bash(echo:*) allow rule",
      observed: `permission_denials=${JSON.stringify(r.denials)}; compound denied=${compoundDenied}; control echo-only allowed=${echoAllowed}`,
      verdict: compoundDenied ? "PASS" : "FAIL",
    }));
    entries.push(verdict({
      probe: "permissions.process-wrapper-smuggling",
      expectation: "`nohup curl ...` is denied because the wrapper is stripped and curl still does not match Bash(echo:*)",
      observed: `permission_denials=${JSON.stringify(r.denials)}; wrapper denied=${wrapperDenied}`,
      verdict: wrapperDenied ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 2: deny-wins-over-allow, same settings level ---
  {
    const r = await runProbe("deny-wins-same-level", {
      settings: { permissions: { allow: ["Bash(echo:*)"], deny: ["Bash(echo:*)"] } },
      prompt: "Via Bash run: echo same-level-test",
    });
    const denied = deniedBashMatching(r.denials, "same-level-test");
    entries.push(verdict({
      probe: "permissions.deny-wins-same-level",
      expectation: "a rule present in both permissions.allow and permissions.deny at the same settings level is denied (deny wins)",
      observed: `permission_denials=${JSON.stringify(r.denials)}`,
      verdict: denied ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 3: deny-wins-over-allow, cross settings level (user tier deny vs project tier allow) ---
  {
    mkdirSync(join(scratchCwd, ".claude"), { recursive: true });
    writeFileSync(join(scratchCwd, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(echo:*)"] } }));
    writeFileSync(join(isolatedConfigDir, "settings.json"), JSON.stringify({ permissions: { deny: ["Bash(echo:*)"] } }));
    const r = await runProbe("deny-wins-cross-level", {
      settings: undefined,
      settingSources: ["user", "project"],
      prompt: "Via Bash run: echo cross-level-test",
    });
    const denied = deniedBashMatching(r.denials, "cross-level-test");
    entries.push(verdict({
      probe: "permissions.deny-wins-cross-level",
      expectation: "user-tier deny (~/.claude equiv settings.json) wins over project-tier allow for the same Bash(echo:*) rule",
      observed: `permission_denials=${JSON.stringify(r.denials)}`,
      verdict: denied ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 4: Edit outside the allowed path denied ---
  {
    const allowedDir = mkdtempSync(join(tmpdir(), "crabgic-spike03-allowed-"));
    const forbiddenDir = mkdtempSync(join(tmpdir(), "crabgic-spike03-forbidden-"));
    const forbiddenFile = join(forbiddenDir, "target.txt");
    writeFileSync(forbiddenFile, "old content\n");
    const allowRule = `Edit(/${allowedDir}/**)`;
    const r = await runProbe("edit-outside-path", {
      // "Read" is allowed broadly so the model can inspect the file before
      // editing (Edit's normal workflow); only Edit itself is path-scoped,
      // isolating the signal to Edit's path enforcement specifically.
      settings: { permissions: { allow: [allowRule, "Read"] } },
      prompt: `Use Edit to change "old" to "new" in ${forbiddenFile}`,
    });
    const denied = deniedTool(r.denials, "Edit");
    const fileUnchanged = readFileSync(forbiddenFile, "utf8").includes("old content");
    entries.push(verdict({
      probe: "permissions.edit-outside-allowed-path",
      expectation: `Edit is denied for a path outside the allow rule (${allowRule}); the file on disk is left unmodified`,
      observed: `permission_denials=${JSON.stringify(r.denials)}; file still contains original content=${fileUnchanged}`,
      verdict: denied && fileUnchanged ? "PASS" : "FAIL",
    }));
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(forbiddenDir, { recursive: true, force: true });
  }

  // --- Probe 5: Agent deny blocks subagent spawning ---
  // RESOLVED by spike 08 (08-tool-catalog-env.mjs) after an initial
  // UNRESOLVED pass: on this engine (2.1.210, SDK and CLI transports,
  // allowlisted AND inherited envs), the subagent-spawn tool's live literal
  // name is "Task" (no tool literally named "Agent" exists), and the
  // "Agent" PERMISSION-RULE name aliases it. Enforcement mechanism: a deny
  // rule for the subagent tool REMOVES "Task" from the model's tool catalog
  // entirely (fail-closed) rather than denying at call time — so
  // permission_denials stays empty by design. This probe therefore asserts
  // catalog-removal, using an earlier run in this same script (no Agent
  // deny -> "Task" present) as the control.
  {
    const r1 = await runProbe("agent-deny-default", {
      settings: { permissions: { deny: ["Agent"] } },
      prompt: "Use the Task tool to spawn a subagent that replies hi.",
    });
    const initMsg = r1.messages.find((m) => m.type === "system" && m.subtype === "init");
    const toolsSeen = initMsg?.tools ?? [];
    const controlInit = allFixtures["deny-wins-same-level"]?.find((m) => m.type === "system" && m.subtype === "init");
    const controlTools = controlInit?.tools ?? [];
    const taskPresentInControl = controlTools.includes("Task");
    const taskRemovedUnderDeny = !toolsSeen.includes("Task");
    const agentToolPresent = toolsSeen.includes("Agent");
    const taskDenied = deniedTool(r1.denials, "Task");

    entries.push(verdict({
      probe: "permissions.agent-deny-blocks-subagent",
      expectation: 'permissions.deny: ["Agent"] blocks subagent spawning — enforced as catalog-removal of the live "Task" tool literal (the "Agent" rule name aliases it; no tool literally named "Agent" exists on 2.1.210)',
      observed: `control run (no Agent deny) catalog includes "Task"=${taskPresentInControl}; deny:["Agent"] run catalog excludes "Task"=${taskRemovedUnderDeny} (tools=${JSON.stringify(toolsSeen)}); tool literally named "Agent" present=${agentToolPresent}; call-time Task denial recorded=${taskDenied} (expected false — enforcement is pre-context removal)`,
      verdict: taskPresentInControl && taskRemovedUnderDeny ? "PASS" : "FAIL",
      note: 'Naming fact for phase 03: the deny rule to write is "Agent" (rule name), which removes the "Task" tool (live literal) from the catalog; deny: ["Task"] works identically (spike 08). See docs/engine-baseline.md §4.',
    }));
  }

  // --- Probe 6/7: Bash colon-spacing verdict ---
  {
    const rNoSpace = await runProbe("colon-no-space", {
      settings: { permissions: { allow: ["Bash(cargo check:*)"] } },
      prompt: "Via Bash run: cargo check --workspace",
    });
    const rSpace = await runProbe("colon-with-space", {
      settings: { permissions: { allow: ["Bash(cargo check :*)"] } },
      prompt: "Via Bash run: cargo check --workspace",
    });
    const noSpaceDenied = deniedBashMatching(rNoSpace.denials, "cargo check");
    const spaceDenied = deniedBashMatching(rSpace.denials, "cargo check");
    let colonVerdict, colonObserved;
    if (!noSpaceDenied && spaceDenied) {
      colonVerdict = "PASS"; colonObserved = "Bash(cargo check:*) (no space before colon) matched and allowed the command; Bash(cargo check :*) (space before colon) did NOT match and the command was denied. No-space form is the required syntax, consistent with the doc's four literal examples.";
    } else if (noSpaceDenied && !spaceDenied) {
      colonVerdict = "PASS"; colonObserved = "Bash(cargo check :*) (space before colon) matched and allowed the command; Bash(cargo check:*) (no space) did NOT match and was denied. Space-before-colon is required for this prefix, contradicting the no-space form of the doc's four literal examples — record verbatim.";
    } else if (!noSpaceDenied && !spaceDenied) {
      colonVerdict = "PASS"; colonObserved = "BOTH forms matched and allowed the command (no-space and space-before-colon both accepted). Colon-spacing is not significant to the matcher.";
    } else {
      colonVerdict = "FAIL"; colonObserved = `neither form allowed the command; no-space denials=${JSON.stringify(rNoSpace.denials)}; with-space denials=${JSON.stringify(rSpace.denials)} — cargo binary absent on host does not affect permission evaluation (denial happens pre-exec), so this is a genuine non-match of both forms.`;
    }
    entries.push(verdict({
      probe: "permissions.bash-colon-spacing",
      expectation: "determine whether Bash(<prefix>:*) requires/forbids a space before the colon for a prefix beyond the doc's four confirmed literals",
      observed: colonObserved,
      verdict: colonVerdict,
    }));
  }
} catch (err) {
  entries.push(verdict({
    probe: "permissions.overall",
    expectation: "all permission sub-probes complete without throwing",
    observed: `threw: ${err?.stack ?? err}`,
    verdict: "FAIL",
  }));
} finally {
  rmSync(isolatedConfigDir, { recursive: true, force: true });
  rmSync(scratchCwd, { recursive: true, force: true });
}

const outPath = join(__dirname, "fixtures", "03-permissions.verdicts.json");
writeVerdicts(outPath, entries);

const fixturePath = join(__dirname, "fixtures", "03-permissions.transcripts.sanitized.json");
const sanitizedFixtures = {};
for (const [name, msgs] of Object.entries(allFixtures)) {
  sanitizedFixtures[name] = msgs.map((m) => JSON.parse(JSON.stringify(m).split(process.env.HOME).join("<HOME>")));
}
writeFileSync(fixturePath, JSON.stringify(sanitizedFixtures, null, 2) + "\n", "utf8");

const hits = scanForSecrets(readFileSync(outPath, "utf8") + readFileSync(fixturePath, "utf8"));
if (hits.length) {
  console.error("SANITIZATION FAILURE:", hits);
  process.exitCode = 1;
} else {
  console.log(`\n${entries.length} verdict(s) recorded to ${outPath}; sanitization scan clean.`);
}
