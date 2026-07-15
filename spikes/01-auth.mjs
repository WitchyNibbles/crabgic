#!/usr/bin/env node
// spikes/01-auth.mjs
//
// Probe: subscription-auth (OAuth) resolution for an SDK worker under
// settingSources: [] + isolated CLAUDE_CONFIG_DIR.
// Sources: roadmap/00-engine-spikes.md work item 2; adaptation doc §5.7, §0.
//
// HOST REALITY (2026-07-15): no `claude setup-token` token has been minted
// today — that command is interactive and the owner was not present to run
// it. Per this phase's host-reality adjustment:
//   - CLAUDE_CODE_OAUTH_TOKEN resolution path -> verdict UNRESOLVED (blocked
//     on owner running `claude setup-token`), recorded separately below.
//   - The documented `.credentials.json` fallback -> ACTUALLY EXERCISED today
//     and given its own PASS/FAIL verdict.
//
// Security (roadmap/00 test plan + task security rules):
//   - Credential bytes are copied ONLY into an os.tmpdir()-based isolated
//     dir, chmod 0600, for the lifetime of this script's fallback probe.
//   - That dir is removed in a `finally` block, success or failure.
//   - No credential byte is ever written under spikes/** (the only files
//     this script writes under the repo are the verdict-summary JSON, which
//     is scanned for token-shaped substrings before being trusted).

import { mkdtempSync, rmSync, copyFileSync, chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const REAL_CREDS = join(process.env.HOME, ".claude", ".credentials.json");
const TOKEN_HANDOFF_FILE = join(process.env.HOME, ".claude", ".eo-oauth-token");
let tokenFirst8 = null; // used only for a post-hoc sanitization grep; never printed

async function runMinimalQuery(isolatedDir, extraEnv) {
  let sawResult = false;
  let resultSubtype = null;
  let isError = false;
  let stderrBuf = "";
  let threw = null;
  try {
    for await (const msg of query({
      prompt: "Reply with the single word: ok",
      options: {
        settingSources: [],
        cwd: isolatedDir,
        env: { PATH: process.env.PATH, HOME: isolatedDir, ...extraEnv },
        model: "haiku",
        maxTurns: 1,
        stderr: (d) => { stderrBuf += d; },
      },
    })) {
      if (msg.type === "result") {
        sawResult = true;
        resultSubtype = msg.subtype;
        isError = !!msg.is_error;
      }
    }
  } catch (err) {
    threw = err?.message ?? String(err);
  }
  return { sawResult, resultSubtype, isError, stderrBuf, threw };
}

// --- Probe A: CLAUDE_CODE_OAUTH_TOKEN path (claude setup-token) ---
// Token sources, in order: env var (already present) > handoff file at
// ~/.claude/.eo-oauth-token (mode 0600), written out-of-band once the owner
// mints one via `claude setup-token`. The token value is held only in a
// local variable, injected into the child SDK worker's env, and NEVER
// written to any file this script produces or printed to stdout/stderr.
let oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
let tokenSource = oauthToken ? "env:CLAUDE_CODE_OAUTH_TOKEN" : null;
let tokenModeNote = "";

if (!oauthToken && existsSync(TOKEN_HANDOFF_FILE)) {
  const st = statSync(TOKEN_HANDOFF_FILE);
  const mode = st.mode & 0o777;
  tokenModeNote = mode !== 0o600 ? ` (WARNING: handoff file mode is ${mode.toString(8)}, expected 0600)` : " (mode 0600 confirmed)";
  oauthToken = readFileSync(TOKEN_HANDOFF_FILE, "utf8").trim();
  tokenSource = `file:${TOKEN_HANDOFF_FILE}`;
}

if (oauthToken) {
  tokenFirst8 = oauthToken.slice(0, 8);
  const isolatedDir = mkdtempSync(join(tmpdir(), "crabgic-spike01-token-"));
  try {
    const r = await runMinimalQuery(isolatedDir, {
      CLAUDE_CONFIG_DIR: isolatedDir,
      CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
    });
    entries.push(verdict({
      probe: "auth.oauth-token-resolution",
      expectation: "SDK worker (settingSources: [] + isolated CLAUDE_CONFIG_DIR) resolves CLAUDE_CODE_OAUTH_TOKEN without interactive login",
      observed: r.threw
        ? `query() threw: ${r.threw} [token source: ${tokenSource}${tokenModeNote}]`
        : r.sawResult
          ? `result received, subtype=${r.resultSubtype}, is_error=${r.isError} [token source: ${tokenSource}${tokenModeNote}]`
          : `no result message observed before stream ended [token source: ${tokenSource}${tokenModeNote}]`,
      verdict: !r.threw && r.sawResult && !r.isError && r.resultSubtype === "success" ? "PASS" : "FAIL",
    }));
  } finally {
    rmSync(isolatedDir, { recursive: true, force: true });
  }
} else {
  entries.push(verdict({
    probe: "auth.oauth-token-resolution",
    expectation: "SDK worker (settingSources: [] + isolated CLAUDE_CONFIG_DIR) resolves CLAUDE_CODE_OAUTH_TOKEN without interactive login",
    observed: "no token available: CLAUDE_CODE_OAUTH_TOKEN unset and no handoff file at ~/.claude/.eo-oauth-token today.",
    verdict: "UNRESOLVED",
    note: "MITIGATION: handoff file pending; re-run spikes/01-auth.mjs once ~/.claude/.eo-oauth-token exists (0600). Alternatively export CLAUDE_CODE_OAUTH_TOKEN directly after `claude setup-token`.",
  }));
}

// --- Probe B: .credentials.json fallback (documented fallback; exercised today) ---
if (!existsSync(REAL_CREDS)) {
  entries.push(verdict({
    probe: "auth.credentials-json-fallback",
    expectation: "copying ~/.claude/.credentials.json (mode 0600) into an isolated CLAUDE_CONFIG_DIR lets an SDK worker (settingSources: []) resolve auth without interactive login",
    observed: `no credentials file found at ${REAL_CREDS}`,
    verdict: "UNRESOLVED",
    note: "MITIGATION: log in interactively once (`claude`, normal session) to populate ~/.claude/.credentials.json, then re-run this script.",
  }));
} else {
  const st = readFileSync(REAL_CREDS); // read-only touch to confirm readability; not logged
  const isolatedDir = mkdtempSync(join(tmpdir(), "crabgic-spike01-fallback-"));
  const isolatedCreds = join(isolatedDir, ".credentials.json");
  try {
    copyFileSync(REAL_CREDS, isolatedCreds);
    chmodSync(isolatedCreds, 0o600);

    const r = await runMinimalQuery(isolatedDir, { CLAUDE_CONFIG_DIR: isolatedDir });

    entries.push(verdict({
      probe: "auth.credentials-json-fallback",
      expectation: "copying ~/.claude/.credentials.json (mode 0600) into an isolated CLAUDE_CONFIG_DIR lets an SDK worker (settingSources: []) resolve auth without interactive login",
      observed: r.threw
        ? `query() threw: ${r.threw}`
        : r.sawResult
          ? `result received, subtype=${r.resultSubtype}, is_error=${r.isError} (${st.length}-byte credentials file copied at 0600; no interactive login/browser flow triggered)`
          : "no result message observed before stream ended",
      verdict: !r.threw && r.sawResult && !r.isError && r.resultSubtype === "success" ? "PASS" : "FAIL",
    }));
  } catch (err) {
    entries.push(verdict({
      probe: "auth.credentials-json-fallback",
      expectation: "copying ~/.claude/.credentials.json (mode 0600) into an isolated CLAUDE_CONFIG_DIR lets an SDK worker (settingSources: []) resolve auth without interactive login",
      observed: `threw: ${err?.message ?? err}`,
      verdict: "FAIL",
    }));
  } finally {
    // Never leave copied credential bytes on disk, success or failure.
    rmSync(isolatedDir, { recursive: true, force: true });
  }
}

const outPath = join(__dirname, "fixtures", "01-auth.verdicts.json");
writeVerdicts(outPath, entries);

// Self-check: no token-shaped substring in the file we just wrote, AND
// (when a real oauth token was used this run) no occurrence of even its
// first 8 characters — per orchestrator directive, this is a hard failure.
const outText = readFileSync(outPath, "utf8");
const hits = scanForSecrets(outText);
if (tokenFirst8 && outText.includes(tokenFirst8)) {
  hits.push({ name: "oauth-token-prefix-8chars", count: 1 });
}
if (hits.length) {
  console.error("SANITIZATION FAILURE in", outPath, hits);
  process.exitCode = 1;
} else {
  console.log(`\n${entries.length} verdict(s) recorded to ${outPath}; sanitization scan clean.`);
}
