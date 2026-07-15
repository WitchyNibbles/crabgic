// Minimal helper to spawn the `claude` CLI binary as a subprocess for probes
// that map most directly onto documented CLI flags (permissions, sandbox,
// sessions). Keeps each probe's invocation visible/auditable rather than
// hidden behind a generic runner.

import { spawn } from "node:child_process";

/**
 * @param {string[]} args - CLI args (NOT including the "claude" binary name)
 * @param {object} opts
 * @param {Record<string,string>} [opts.env] - full replacement env (PATH etc. must be included)
 * @param {string} [opts.cwd]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{code:number|null, signal:string|null, stdout:string, stderr:string, timedOut:boolean}>}
 */
export function runClaude(args, opts = {}) {
  const { env, cwd, timeoutMs = 60000 } = opts;
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

// Spawn without waiting for close, so the caller can kill -9 mid-run.
export function spawnClaude(args, opts = {}) {
  const { env, cwd } = opts;
  const child = spawn("claude", args, {
    cwd,
    env: env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));
  return { child, getStdout: () => stdout, getStderr: () => stderr };
}

export function baseEnv(extra = {}) {
  // Minimal, explicit env: PATH (binary resolution) + HOME (some tooling
  // shells out to git etc.) + whatever the probe adds. Never inherits
  // ambient auth env vars unless a probe explicitly asks for that.
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...extra,
  };
}
