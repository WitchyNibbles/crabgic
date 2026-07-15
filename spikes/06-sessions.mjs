#!/usr/bin/env node
// spikes/06-sessions.mjs
//
// Probes (roadmap/00-engine-spikes.md work item 7; adaptation §5.6, Appendix A):
//   - pre-assigned --session-id honored
//   - kill -9 mid-run then --resume from the same cwd continues with context intact
//   - --fork-session leaves the original transcript file untouched
//   - two concurrent same-directory sessions (distinct --session-id) do not interleave
//
// Transport: CLI subprocess (`claude -p`), spawned directly via node
// child_process (no shell) — needed for literal `kill -9` process control
// and for concurrent-process interleaving, which the SDK's single
// in-process query() does not model as directly as two real OS processes.
// Both transports spawn the same underlying engine.

import { mkdtempSync, rmSync, copyFileSync, chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runClaude, spawnClaude } from "./lib/cli.mjs";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const REAL_CREDS = join(process.env.HOME, ".claude", ".credentials.json");

if (!existsSync(REAL_CREDS)) {
  entries.push(verdict({
    probe: "sessions.overall",
    expectation: "session sub-probes run against a live CLI worker",
    observed: `cannot run: no credentials file at ${REAL_CREDS}`,
    verdict: "UNRESOLVED",
    note: "MITIGATION: log in interactively once to populate ~/.claude/.credentials.json, then re-run.",
  }));
  writeVerdicts(join(__dirname, "fixtures", "06-sessions.verdicts.json"), entries);
  process.exit(0);
}

// Targeted-run mode (validation round): SPIKE06_ONLY=kill9 runs ONLY the
// kill-9/resume probe and MERGES its verdict + raw-output entries into the
// existing committed fixtures (replacing the matching probe/keys) instead of
// overwriting the whole files — so the other three probes' committed
// evidence stays traceable to the run that produced it without re-spending
// their queries. Default (env unset): full run, full overwrite, as always.
const ONLY_KILL9 = process.env.SPIKE06_ONLY === "kill9";

const isolatedConfigDir = mkdtempSync(join(tmpdir(), "crabgic-spike06-config-"));
const scratchCwd = mkdtempSync(join(tmpdir(), "crabgic-spike06-cwd-"));
copyFileSync(REAL_CREDS, join(isolatedConfigDir, ".credentials.json"));
chmodSync(join(isolatedConfigDir, ".credentials.json"), 0o600);

const env = { PATH: process.env.PATH, HOME: isolatedConfigDir, CLAUDE_CONFIG_DIR: isolatedConfigDir };
const rawOutputs = {};

function parseJsonResult(stdout) {
  try { return JSON.parse(stdout); } catch { return null; }
}

function findTranscript(sessionId) {
  const projectsDir = join(isolatedConfigDir, "projects");
  if (!existsSync(projectsDir)) return null;
  for (const dir of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // --- Probe 1: pre-assigned --session-id honored ---
  if (!ONLY_KILL9) {
    const sid = randomUUID();
    const r = await runClaude([
      "-p", "Reply with just: ok",
      "--model", "haiku", "--output-format", "json",
      "--setting-sources", "",
      "--session-id", sid,
    ], { env, cwd: scratchCwd, timeoutMs: 30000 });
    rawOutputs["preassigned-session-id"] = r;
    const json = parseJsonResult(r.stdout);
    const transcript = findTranscript(sid);
    const matched = json?.session_id === sid && !!transcript;
    entries.push(verdict({
      probe: "sessions.preassigned-session-id",
      expectation: "--session-id <uuid> is honored: the result's session_id equals the requested uuid, and a transcript file is created at that id",
      observed: `requested=${sid}, result.session_id=${json?.session_id ?? "none"}, transcript found=${!!transcript}`,
      verdict: matched ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 2: kill -9 mid-run, then --resume continuity ---
  // Fixture-quality fix (validation round): the first version used
  // --output-format json (single result at end), so the SIGKILLed process
  // had emitted ZERO stdout bytes and the "crash" fixture was empty. This
  // version streams (stream-json + include-partial-messages), waits for the
  // first complete stream event line — guaranteeing a genuine non-empty
  // crash-truncated stream prefix in the fixture — and keeps a 3.5s floor
  // before SIGKILL so the worker has reached the sleep(8) Bash call
  // (preserves the resume-continuity behavior verified in earlier passes;
  // the PASS criterion below is unchanged).
  {
    const sid = randomUUID();
    const { child, getStdout, getStderr } = spawnClaude([
      "-p", "Remember the number 42 for later. Then via Bash run: sleep 8",
      "--model", "haiku",
      "--output-format", "stream-json", "--include-partial-messages", "--verbose",
      "--setting-sources", "",
      "--settings", JSON.stringify({ permissions: { allow: ["Bash(sleep:*)"] } }),
      "--permission-mode", "dontAsk",
      "--session-id", sid,
    ], { env, cwd: scratchCwd });
    const spawnedAt = Date.now();
    while (!getStdout().includes("\n") && Date.now() - spawnedAt < 15000) await delay(200);
    const elapsed = Date.now() - spawnedAt;
    if (elapsed < 3500) await delay(3500 - elapsed);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.on("close", resolve));
    const streamPrefix = getStdout();
    const streamPrefixLines = streamPrefix.split("\n").filter((l) => l.trim()).length;
    rawOutputs["kill9-initial"] = {
      transport: "cli --output-format stream-json --include-partial-messages",
      killedWith: "SIGKILL",
      streamPrefixLines,
      stdout: streamPrefix,
      stderr: getStderr(),
    };

    const rResume = await runClaude([
      "-p", "What number should you remember? Reply with just the number.",
      "--model", "haiku", "--output-format", "json",
      "--setting-sources", "",
      "--resume", sid,
    ], { env, cwd: scratchCwd, timeoutMs: 30000 });
    rawOutputs["kill9-resume"] = rResume;
    const resumeJson = parseJsonResult(rResume.stdout);
    const recalled = (resumeJson?.result ?? "").includes("42");
    entries.push(verdict({
      probe: "sessions.kill9-resume-continuity",
      expectation: "after kill -9 mid-run, `--resume <same session-id>` from the same cwd continues with prior context intact; the killed run's fixture carries a non-empty crash-truncated stream-json prefix",
      observed: `crash-stream prefix captured before SIGKILL: ${streamPrefixLines} event line(s); resume result="${resumeJson?.result ?? "(none)"}"; contains "42"=${recalled}`,
      verdict: recalled ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 3: --fork-session leaves the original transcript untouched ---
  if (!ONLY_KILL9) {
    const sid = randomUUID();
    const rInitial = await runClaude([
      "-p", "Remember the word BANANA123. Reply with just: ok",
      "--model", "haiku", "--output-format", "json",
      "--setting-sources", "",
      "--session-id", sid,
    ], { env, cwd: scratchCwd, timeoutMs: 30000 });
    rawOutputs["fork-initial"] = rInitial;
    const transcriptPath = findTranscript(sid);
    const beforeContent = transcriptPath ? readFileSync(transcriptPath, "utf8") : null;

    const rFork = await runClaude([
      "-p", "What word did I ask you to remember? Reply with just the word.",
      "--model", "haiku", "--output-format", "json",
      "--setting-sources", "",
      "--resume", sid, "--fork-session",
    ], { env, cwd: scratchCwd, timeoutMs: 30000 });
    rawOutputs["fork-resumed"] = rFork;
    const forkJson = parseJsonResult(rFork.stdout);
    const afterContent = transcriptPath ? readFileSync(transcriptPath, "utf8") : null;
    const originalUnchanged = beforeContent !== null && beforeContent === afterContent;
    const forkGotNewSessionId = !!forkJson?.session_id && forkJson.session_id !== sid;
    const forkRecalledContext = (forkJson?.result ?? "").includes("BANANA123");
    const forkTranscriptExists = forkJson?.session_id ? !!findTranscript(forkJson.session_id) : false;

    entries.push(verdict({
      probe: "sessions.fork-session-isolation",
      expectation: "--fork-session (with --resume) creates a new session id, carries prior context into the fork, and leaves the ORIGINAL transcript file byte-identical",
      observed: `original transcript unchanged=${originalUnchanged}; fork got new session_id=${forkGotNewSessionId} (${forkJson?.session_id ?? "none"}); fork recalled context=${forkRecalledContext}; fork has its own transcript file=${forkTranscriptExists}`,
      verdict: originalUnchanged && forkGotNewSessionId && forkRecalledContext && forkTranscriptExists ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 4: two concurrent same-dir sessions, distinct session-ids, no interleave ---
  if (!ONLY_KILL9) {
    const sidA = randomUUID();
    const sidB = randomUUID();
    const [rA, rB] = await Promise.all([
      runClaude([
        "-p", "Remember the word ALPHA777. Then via Bash run: sleep 3. Reply with just: ok",
        "--model", "haiku", "--output-format", "json", "--setting-sources", "",
        "--settings", JSON.stringify({ permissions: { allow: ["Bash(sleep:*)"] } }),
        "--permission-mode", "dontAsk", "--session-id", sidA,
      ], { env, cwd: scratchCwd, timeoutMs: 30000 }),
      runClaude([
        "-p", "Remember the word ZETA999. Then via Bash run: sleep 3. Reply with just: ok",
        "--model", "haiku", "--output-format", "json", "--setting-sources", "",
        "--settings", JSON.stringify({ permissions: { allow: ["Bash(sleep:*)"] } }),
        "--permission-mode", "dontAsk", "--session-id", sidB,
      ], { env, cwd: scratchCwd, timeoutMs: 30000 }),
    ]);
    rawOutputs["concurrent-A"] = rA;
    rawOutputs["concurrent-B"] = rB;

    const [rAResume, rBResume] = await Promise.all([
      runClaude(["-p", "What word? Reply with just the word.", "--model", "haiku", "--output-format", "json", "--setting-sources", "", "--resume", sidA], { env, cwd: scratchCwd, timeoutMs: 30000 }),
      runClaude(["-p", "What word? Reply with just the word.", "--model", "haiku", "--output-format", "json", "--setting-sources", "", "--resume", sidB], { env, cwd: scratchCwd, timeoutMs: 30000 }),
    ]);
    rawOutputs["concurrent-A-resume"] = rAResume;
    rawOutputs["concurrent-B-resume"] = rBResume;
    const aJson = parseJsonResult(rAResume.stdout);
    const bJson = parseJsonResult(rBResume.stdout);
    const aCorrect = (aJson?.result ?? "").includes("ALPHA777") && !(aJson?.result ?? "").includes("ZETA999");
    const bCorrect = (bJson?.result ?? "").includes("ZETA999") && !(bJson?.result ?? "").includes("ALPHA777");

    entries.push(verdict({
      probe: "sessions.concurrent-no-interleave",
      expectation: "two concurrent same-cwd sessions with distinct --session-ids maintain fully separate context (no cross-talk)",
      observed: `session A recalled its own word only=${aCorrect} (reply="${aJson?.result ?? ""}"); session B recalled its own word only=${bCorrect} (reply="${bJson?.result ?? ""}")`,
      verdict: aCorrect && bCorrect ? "PASS" : "FAIL",
    }));
  }
} catch (err) {
  entries.push(verdict({
    probe: "sessions.overall",
    expectation: "all session sub-probes complete without throwing",
    observed: `threw: ${err?.stack ?? err}`,
    verdict: "FAIL",
  }));
} finally {
  rmSync(isolatedConfigDir, { recursive: true, force: true });
  rmSync(scratchCwd, { recursive: true, force: true });
}

const outPath = join(__dirname, "fixtures", "06-sessions.verdicts.json");
const fixturePath = join(__dirname, "fixtures", "06-sessions.raw.sanitized.json");
const sanitized = JSON.parse(JSON.stringify(rawOutputs).split(process.env.HOME).join("<HOME>"));

if (ONLY_KILL9 && existsSync(outPath) && existsSync(fixturePath)) {
  // Merge: replace only the entries/keys this targeted run produced.
  const mergedVerdicts = JSON.parse(readFileSync(outPath, "utf8")).map((old) => {
    const replacement = entries.find((e) => e.probe === old.probe);
    return replacement ?? old;
  });
  for (const e of entries) {
    if (!mergedVerdicts.some((v) => v.probe === e.probe)) mergedVerdicts.push(e);
  }
  writeVerdicts(outPath, mergedVerdicts);
  const mergedRaw = { ...JSON.parse(readFileSync(fixturePath, "utf8")), ...sanitized };
  writeFileSync(fixturePath, JSON.stringify(mergedRaw, null, 2) + "\n", "utf8");
  console.log(`\n[SPIKE06_ONLY=kill9] merged ${entries.length} verdict(s) + ${Object.keys(sanitized).length} raw key(s) into existing fixtures.`);
} else {
  writeVerdicts(outPath, entries);
  writeFileSync(fixturePath, JSON.stringify(sanitized, null, 2) + "\n", "utf8");
}

const hits = scanForSecrets(readFileSync(outPath, "utf8") + readFileSync(fixturePath, "utf8"));
if (hits.length) {
  console.error("SANITIZATION FAILURE:", hits);
  process.exitCode = 1;
} else {
  console.log(`\nverdicts at ${outPath}; sanitization scan clean.`);
}
