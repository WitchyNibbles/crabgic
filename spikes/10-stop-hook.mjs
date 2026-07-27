#!/usr/bin/env node
// spikes/10-stop-hook.mjs
//
// Probes the STOP-HOOK CONTROL CONTRACT, which the manager autonomy gate
// (`packages/plugin/hooks/stop-autonomy-gate.mjs`) is built directly on.
//
// roadmap/10 originally scoped manager-side hooks as advisory-only, and the
// adaptation doc's hook analysis (§3.1) is about PreToolUse — `permissionDecision`,
// exit-2-blocks-the-call. NEITHER covers what a `Stop` hook can do. Since the
// autonomy gate's whole job is to REFUSE to let a turn end while a run is still
// in flight, three things have to be true, and none of them may be assumed:
//
//   A. A Stop hook returning `{"decision":"block","reason":...}` on stdout
//      actually prevents the turn from ending, and the `reason` is delivered to
//      the model as the instruction for what to do next.
//   B. `stop_hook_active` is set on the payload of the RE-ENTERED Stop event,
//      so a hook can tell "I already blocked once" from "first time here".
//      Without this the gate could loop forever, which is the single worst
//      failure mode available to it.
//   C. The payload carries the fields the gate reads (`cwd` at minimum, to
//      resolve which project's supervisor to ask).
//
// Method: a scratch project whose settings register a Stop hook pointing at a
// generated script. That script appends every payload it receives to a log,
// and blocks EXACTLY ONCE (guarded by a marker file rather than by
// `stop_hook_active`, deliberately — using the very field under test as the
// loop guard would make claim B untestable and risk a runaway loop if it is
// absent). The block reason instructs the model to emit a rare sentinel; the
// sentinel appearing in the final output is the observable proof that the turn
// was resumed and the reason reached the model.

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude } from "./lib/cli.mjs";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];
const SENTINEL = "PLATYPUS7";

const projectDir = mkdtempSync(join(tmpdir(), "crabgic-spike10-project-"));
const logPath = join(projectDir, "stop-payloads.jsonl");
const markerPath = join(projectDir, "already-blocked");
const hookPath = join(projectDir, "stop-hook.mjs");

const hookSource = `#!/usr/bin/env node
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
appendFileSync(${JSON.stringify(logPath)}, raw.trim() + "\\n");
// Block exactly once, guarded by a marker file — NOT by stop_hook_active,
// which is the field this probe exists to test.
if (existsSync(${JSON.stringify(markerPath)})) {
  process.exit(0);
}
writeFileSync(${JSON.stringify(markerPath)}, "1");
process.stdout.write(JSON.stringify({
  decision: "block",
  reason: "Before you finish: output the single word ${SENTINEL} and nothing else.",
}));
process.exit(0);
`;
writeFileSync(hookPath, hookSource, "utf8");
chmodSync(hookPath, 0o755);

const settings = {
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: `${process.execPath} ${hookPath}` }] }],
  },
};
const settingsPath = join(projectDir, "settings.json");
writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
mkdirSync(join(projectDir, ".claude"), { recursive: true });

try {
  const res = await runClaude(
    ["-p", "Reply with just: ok", "--model", "haiku", "--settings", settingsPath],
    { cwd: projectDir, timeoutMs: 120000 },
  );

  const payloads = existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];

  const sawSentinel = res.stdout.includes(SENTINEL);
  const invocations = payloads.length;

  // --- A: does the block actually take effect? ---
  entries.push(
    verdict({
      probe: "stop-hook.block-decision-resumes-the-turn",
      expectation:
        'a Stop hook emitting {"decision":"block","reason":R} prevents the turn from ending, and R reaches the model as its next instruction',
      observed:
        `hook invoked ${invocations}x; sentinel "${SENTINEL}" present in final stdout=${sawSentinel}; ` +
        `exit=${res.code}; timedOut=${res.timedOut}; stdout=${JSON.stringify(res.stdout.slice(0, 400))}`,
      verdict: invocations === 0 ? "UNRESOLVED" : sawSentinel && invocations >= 2 ? "PASS" : "FAIL",
      ...(invocations === 0
        ? { note: "MITIGATION: the Stop hook never ran at all — check whether --settings hooks are honored in -p mode on this version before concluding anything about the block contract." }
        : {}),
    }),
  );

  // --- B: the loop guard ---
  const reentered = payloads[1];
  const stopHookActiveOnReentry = reentered?.stop_hook_active;
  entries.push(
    verdict({
      probe: "stop-hook.stop_hook_active-set-on-reentry",
      expectation:
        "the re-entered Stop event carries stop_hook_active:true, giving a blocking hook a reliable way to avoid looping forever",
      observed:
        invocations < 2
          ? `only ${invocations} invocation(s) recorded — no re-entry to inspect`
          : `first invocation stop_hook_active=${JSON.stringify(payloads[0]?.stop_hook_active)}; ` +
            `second invocation stop_hook_active=${JSON.stringify(stopHookActiveOnReentry)}`,
      verdict:
        invocations < 2 ? "UNRESOLVED" : stopHookActiveOnReentry === true ? "PASS" : "FAIL",
      ...(invocations >= 2 && stopHookActiveOnReentry !== true
        ? { note: "CRITICAL for the autonomy gate: without this flag the gate MUST carry its own external loop guard, or a blocked turn can never end." }
        : {}),
    }),
  );

  // --- C: payload shape the gate reads ---
  const first = payloads[0] ?? {};
  const keys = Object.keys(first).sort();
  entries.push(
    verdict({
      probe: "stop-hook.payload-shape",
      expectation:
        "the Stop payload carries at least `cwd` (which project's supervisor to ask) and `session_id`",
      observed: `payload keys: ${JSON.stringify(keys)}; cwd present=${typeof first.cwd === "string"}; session_id present=${typeof first.session_id === "string"}`,
      verdict:
        invocations === 0 ? "UNRESOLVED" : typeof first.cwd === "string" ? "PASS" : "FAIL",
      ...(invocations > 0 && typeof first.cwd !== "string"
        ? { note: "The gate must fall back to process.cwd() — record that as the resolution rule." }
        : {}),
    }),
  );

  // The payload carries absolute paths (`transcript_path`, `cwd`) that sit
  // under $HOME on a developer host. The shape is what this fixture is for,
  // not the paths, so redact before the sanitization scan rather than
  // discarding an otherwise-clean capture.
  const redact = (value) =>
    typeof value === "string" ? value.split(process.env.HOME).join("$HOME") : value;
  const redactedPayloads = payloads.map((p) =>
    Object.fromEntries(Object.entries(p).map(([k, v]) => [k, redact(v)])),
  );

  const fixture = {
    engineStdoutExcerpt: redact(res.stdout.slice(0, 800)),
    invocations,
    payloads: redactedPayloads,
  };
  const payloadText = JSON.stringify(fixture, null, 2) + "\n";
  const hits = scanForSecrets(payloadText);
  if (hits.length > 0) {
    entries.push(
      verdict({
        probe: "stop-hook.fixture-sanitized",
        expectation: "no token-shaped or $HOME-path content is written to the committed fixture",
        observed: `secret-scan hits: ${JSON.stringify(hits)} — fixture NOT written`,
        verdict: "FAIL",
      }),
    );
  } else {
    writeVerdicts(join(__dirname, "fixtures", "10-stop-hook.payloads.sanitized.json"), fixture);
  }
} finally {
  rmSync(projectDir, { recursive: true, force: true });
}

writeVerdicts(join(__dirname, "fixtures", "10-stop-hook.verdicts.json"), entries);
const failed = entries.filter((e) => e.verdict === "FAIL");
console.log(`\n${entries.length} verdicts, ${failed.length} FAIL`);
process.exitCode = failed.length > 0 ? 1 : 0;
