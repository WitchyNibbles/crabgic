#!/usr/bin/env node
// spikes/04-sandbox.mjs
//
// Probes (roadmap/00-engine-spikes.md work item 5; adaptation §4.2, Appendix A/B):
//   - bwrap presence
//   - failIfUnavailable aborts when forced-broken
//   - egress denied with empty allowedDomains
//   - UDS reachable with allowAllUnixSockets: true
//   - denyRead ~/.ssh enforced
//   - credentials.envVars mode: mask shows placeholder, never the real value
//
// HOST UPDATE (2026-07-15, mid-run): bubblewrap 0.9.0 and socat installed by
// the orchestrator (/usr/bin/bwrap, /usr/bin/socat) — the FULL suite below
// runs for real, not just the "absent" degraded path.
//
// Transport: Agent SDK `query()` with the top-level `Options.sandbox` field
// (SandboxSettings) — NOT `settings.sandbox` — because the SDK docstring for
// `Options.sandbox` states a materially different `failIfUnavailable` default
// (true, once `enabled: true`) than the settings.json-level key (false); see
// docs/engine-baseline.md for the discrepancy writeup.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const REAL_CREDS = join(process.env.HOME, ".claude", ".credentials.json");
const allFixtures = {};

if (!existsSync(REAL_CREDS)) {
  entries.push(verdict({
    probe: "sandbox.overall",
    expectation: "sandbox sub-probes run against a live SDK worker",
    observed: `cannot run: no credentials file at ${REAL_CREDS}`,
    verdict: "UNRESOLVED",
    note: "MITIGATION: log in interactively once to populate ~/.claude/.credentials.json, then re-run.",
  }));
  writeVerdicts(join(__dirname, "fixtures", "04-sandbox.verdicts.json"), entries);
  process.exit(0);
}

const isolatedConfigDir = mkdtempSync(join(tmpdir(), "crabgic-spike04-config-"));
copyFileSync(REAL_CREDS, join(isolatedConfigDir, ".credentials.json"));
chmodSync(join(isolatedConfigDir, ".credentials.json"), 0o600);

async function runProbe(name, { settings, sandbox, permissionMode = "dontAsk", allowRules = [], env, maxTurns = 3, prompt, timeoutMs = 45000 }) {
  const messages = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let threw = null;
  try {
    for await (const msg of query({
      prompt,
      options: {
        settingSources: [],
        settings: { permissions: { allow: allowRules }, ...(settings ?? {}) },
        sandbox,
        permissionMode,
        cwd: isolatedConfigDir,
        env: env ?? { PATH: process.env.PATH, HOME: isolatedConfigDir, CLAUDE_CONFIG_DIR: isolatedConfigDir },
        model: "haiku",
        maxTurns,
        abortController: ac,
      },
    })) {
      messages.push(msg);
    }
  } catch (err) {
    threw = err?.message ?? String(err);
  } finally {
    clearTimeout(timer);
  }
  allFixtures[name] = messages;
  const result = messages.find((m) => m.type === "result");
  const allText = messages.map((m) => JSON.stringify(m)).join("\n");
  return { messages, result, allText, threw, timedOut: ac.signal.aborted };
}

function bashOutputContaining(messages, needleTest) {
  // scan 'user' messages carrying tool_result content for Bash calls
  for (const m of messages) {
    if (m.type !== "user") continue;
    const content = m.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        if (needleTest(text)) return text;
      }
    }
  }
  return null;
}

try {
  // --- Probe 1: bwrap presence ---
  {
    const { execFileSync } = await import("node:child_process");
    let bwrapPath = null;
    try { bwrapPath = execFileSync("which", ["bwrap"]).toString().trim(); } catch {}
    entries.push(verdict({
      probe: "sandbox.bwrap-presence",
      expectation: "bwrap (bubblewrap) binary is present on PATH for Linux/WSL2 sandboxing",
      observed: bwrapPath ? `found at ${bwrapPath}` : "not found on PATH",
      verdict: bwrapPath ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 2: failIfUnavailable aborts when forced-broken ---
  // Force "unavailable" by starving PATH down to just the claude binary's
  // own directory, so the sandbox runtime's own bwrap auto-detection fails,
  // without touching any admin-only bwrapPath override.
  {
    // Resolve the claude binary's own directory dynamically (portable across
    // hosts) rather than hardcoding a path, then starve PATH down to just
    // that dir + node's own dir so bwrap becomes unresolvable.
    const { execFileSync } = await import("node:child_process");
    const claudeBinDir = dirname(execFileSync("which", ["claude"]).toString().trim());
    const starvedPath = `${dirname(process.execPath)}:${claudeBinDir}`;
    const r = await runProbe("fail-if-unavailable", {
      sandbox: { enabled: true, failIfUnavailable: true },
      allowRules: ["Bash(echo:*)"],
      env: { PATH: starvedPath, HOME: isolatedConfigDir, CLAUDE_CONFIG_DIR: isolatedConfigDir },
      prompt: "Via Bash run: echo should-not-run-if-sandbox-unavailable",
      timeoutMs: 30000,
    });
    const abortedOrErrored = !!r.threw || (r.result && (r.result.is_error || r.result.subtype !== "success"));
    const ranAnyway = bashOutputContaining(r.messages, (t) => t.includes("should-not-run-if-sandbox-unavailable")) !== null;
    entries.push(verdict({
      probe: "sandbox.fail-if-unavailable-aborts",
      expectation: "with sandbox.enabled + failIfUnavailable:true and bwrap made unresolvable (starved PATH), the worker aborts rather than running the command unsandboxed",
      observed: r.threw
        ? `query() threw: ${r.threw}`
        : `result=${r.result ? JSON.stringify({ subtype: r.result.subtype, is_error: r.result.is_error }) : "none"}; command output observed anyway=${ranAnyway}`,
      verdict: abortedOrErrored && !ranAnyway ? "PASS" : (ranAnyway ? "FAIL" : "UNRESOLVED"),
      ...(!abortedOrErrored && !ranAnyway ? { note: "neither a clean abort nor the command output was observed; inspect sanitized fixture" } : {}),
    }));
  }

  // --- Probe 3: egress denied with empty allowedDomains ---
  {
    const r = await runProbe("egress-denied", {
      sandbox: { enabled: true, failIfUnavailable: true, network: { allowedDomains: [] } },
      allowRules: ["Bash(curl:*)"],
      prompt: "Via Bash run: curl -m 5 -s -o /dev/null -w 'HTTPCODE:%{http_code} ERR:%{exitcode}' http://example.com ; echo DONE",
      timeoutMs: 30000,
    });
    const sawSuccessCode = bashOutputContaining(r.messages, (t) => t.includes("HTTPCODE:200")) !== null;
    // Observed live behavior: the sandbox network proxy intercepts the
    // disallowed request and returns HTTP 403 itself (curl exit 0 — curl
    // successfully talked to the proxy, which then refused the request) —
    // NOT a connection-refused/DNS-failure shape. Recorded verbatim.
    const sawProxyForbidden = bashOutputContaining(r.messages, (t) => t.includes("HTTPCODE:403")) !== null;
    const sawOtherFailureSignal = bashOutputContaining(r.messages, (t) => /ERR:[1-9]|Could not resolve|Connection refused|Network is unreachable|timed out/i.test(t)) !== null;
    entries.push(verdict({
      probe: "sandbox.egress-denied-empty-allowlist",
      expectation: "with sandbox network.allowedDomains: [], a Bash-invoked curl to an external host fails (no egress), even though the Bash tool call itself is permission-allowed",
      observed: r.threw
        ? `query() threw: ${r.threw}`
        : `sawSuccessCode(200)=${sawSuccessCode}; sawProxyForbidden(403)=${sawProxyForbidden}; sawOtherFailureSignal=${sawOtherFailureSignal}. Live behavior: the sandbox's network proxy answers disallowed requests with HTTP 403 itself (curl exits 0 — it reached the proxy, not example.com) rather than a connection-refused/DNS-failure shape.`,
      verdict: !sawSuccessCode && (sawProxyForbidden || sawOtherFailureSignal) ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 4: UDS reachable with allowAllUnixSockets: true ---
  // NOTE: adaptation Appendix A cites `network.allowUnixSockets: true` as a
  // boolean; the live schema types allowUnixSockets as string[] (macOS-only
  // path allowlist, "ignored on Linux (seccomp cannot filter by path)" per
  // its own doc comment). The Linux/WSL2-relevant boolean gate is a
  // DIFFERENTLY NAMED key: `allowAllUnixSockets`. Tested below.
  {
    const socketPath = join(isolatedConfigDir, "uds-test.sock");
    if (existsSync(socketPath)) rmSync(socketPath);
    const server = createServer((_req, res) => res.end("PONG"));
    await new Promise((resolve, reject) => { server.listen(socketPath, resolve); server.on("error", reject); });

    try {
      const rDenied = await runProbe("uds-denied", {
        sandbox: { enabled: true, failIfUnavailable: true },
        allowRules: ["Bash(curl:*)"],
        prompt: `Via Bash run: curl -m 5 -s --unix-socket ${socketPath} http://localhost/ping ; echo DONE`,
        timeoutMs: 30000,
      });
      const rAllowed = await runProbe("uds-allowed", {
        sandbox: { enabled: true, failIfUnavailable: true, network: { allowAllUnixSockets: true } },
        allowRules: ["Bash(curl:*)"],
        prompt: `Via Bash run: curl -m 5 -s --unix-socket ${socketPath} http://localhost/ping ; echo DONE`,
        timeoutMs: 30000,
      });
      const pongDenied = bashOutputContaining(rDenied.messages, (t) => t.includes("PONG")) !== null;
      const pongAllowed = bashOutputContaining(rAllowed.messages, (t) => t.includes("PONG")) !== null;
      entries.push(verdict({
        probe: "sandbox.uds-reachability",
        expectation: "a Unix domain socket is unreachable from the sandbox by default and reachable once `network.allowAllUnixSockets: true` is set (adaptation's `allowUnixSockets: true` boolean does not match the live string[]/macOS-only schema)",
        observed: `default config: PONG seen=${pongDenied}; allowAllUnixSockets:true config: PONG seen=${pongAllowed}`,
        verdict: !pongDenied && pongAllowed ? "PASS" : "FAIL",
        note: 'SCHEMA CORRECTION: live SandboxSettings.network.allowUnixSockets is string[] (macOS path allowlist, ignored on Linux/WSL2); the Linux-relevant boolean is allowAllUnixSockets. Adaptation Appendix A\'s `allowUnixSockets: true` boolean form does not apply on this platform.',
      }));
    } finally {
      server.close();
      rmSync(socketPath, { force: true });
    }
  }

  // --- Probe 5: denyRead ~/.ssh enforced ---
  // NB: the marker file deliberately avoids "id_rsa"/"private key" naming —
  // an earlier run using those names triggered the MODEL's own safety
  // refusal to cat a file that merely looked like an SSH private key,
  // confounding the sandbox-mechanism test entirely (both variants "failed"
  // for the wrong reason). The directory must still be literally named
  // ".ssh" since that's the path the denyRead rule targets.
  {
    const sshDir = join(isolatedConfigDir, ".ssh");
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(join(sshDir, "config-data.txt"), "MARKER-VALUE-9f2c-should-not-be-readable-if-denied\n");

    const rNoDeny = await runProbe("sshread-no-deny", {
      sandbox: { enabled: true, failIfUnavailable: true },
      allowRules: ["Bash(cat:*)"],
      prompt: `Via Bash run: cat ${join(sshDir, "config-data.txt")}`,
      timeoutMs: 30000,
    });
    const rWithDeny = await runProbe("sshread-with-deny", {
      sandbox: { enabled: true, failIfUnavailable: true, filesystem: { denyRead: ["~/.ssh"] } },
      allowRules: ["Bash(cat:*)"],
      prompt: `Via Bash run: cat ${join(sshDir, "config-data.txt")}`,
      timeoutMs: 30000,
    });
    const secretSeenNoDeny = rNoDeny.allText.includes("MARKER-VALUE-9f2c-should-not-be-readable-if-denied");
    const secretSeenWithDeny = rWithDeny.allText.includes("MARKER-VALUE-9f2c-should-not-be-readable-if-denied");
    entries.push(verdict({
      probe: "sandbox.denyread-ssh-enforced",
      expectation: "sandbox default is read-open (secret readable without denyRead) but sandbox.filesystem.denyRead: ['~/.ssh'] blocks the same Bash `cat` read",
      observed: `without denyRead: secret content observed=${secretSeenNoDeny}; with denyRead ~/.ssh: secret content observed=${secretSeenWithDeny}`,
      verdict: secretSeenNoDeny && !secretSeenWithDeny ? "PASS" : "FAIL",
    }));
  }

  // --- Probe 6: credentials.envVars mode: mask shows placeholder only ---
  {
    const REAL_SECRET = "REAL-SECRET-VALUE-9f21ac";
    const r = await runProbe("masked-env", {
      sandbox: { enabled: true, failIfUnavailable: true, credentials: { envVars: [{ name: "EO_SECRET_X", mode: "mask" }] } },
      allowRules: ["Bash(echo:*)"],
      env: { PATH: process.env.PATH, HOME: isolatedConfigDir, CLAUDE_CONFIG_DIR: isolatedConfigDir, EO_SECRET_X: REAL_SECRET },
      prompt: "Via Bash run: echo VALUE=$EO_SECRET_X",
      timeoutMs: 30000,
    });
    const realValueLeaked = r.allText.includes(REAL_SECRET);
    const sawSomeValue = bashOutputContaining(r.messages, (t) => /VALUE=\S+/.test(t)) !== null;
    entries.push(verdict({
      probe: "sandbox.masked-credential-envvar",
      expectation: "sandbox.credentials.envVars mode:'mask' substitutes a sentinel for EO_SECRET_X inside the sandbox; the real value never appears in the worker's resolved env/output",
      observed: `real secret value leaked into transcript=${realValueLeaked}; some VALUE= output observed=${sawSomeValue}`,
      verdict: !realValueLeaked && sawSomeValue ? "PASS" : "FAIL",
    }));
  }
} catch (err) {
  entries.push(verdict({
    probe: "sandbox.overall",
    expectation: "all sandbox sub-probes complete without throwing",
    observed: `threw: ${err?.stack ?? err}`,
    verdict: "FAIL",
  }));
} finally {
  rmSync(isolatedConfigDir, { recursive: true, force: true });
}

const outPath = join(__dirname, "fixtures", "04-sandbox.verdicts.json");
writeVerdicts(outPath, entries);

const fixturePath = join(__dirname, "fixtures", "04-sandbox.transcripts.sanitized.json");
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
