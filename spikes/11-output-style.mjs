#!/usr/bin/env node
// spikes/11-output-style.mjs
//
// Probes whether OUTPUT STYLES are reachable as a crabgic-shipped artifact.
//
// WHY. `docs/design/format-gate-production.md` §L0 proposes the highest-leverage
// possible improvement to the manager report-format gate: an output style
// replaces the assistant's base communication prompt, so the reporting rules
// would become the model's default register instead of an instruction it may
// drift from — prevention rather than a blocking hook after the fact.
//
// Nothing in `docs/engine-baseline.md` or `docs/claude-code-adaptation.md` says
// anything about output styles, and the project's ground rule forbids assuming
// engine facts from memory. Hence this.
//
// TWO TIERS, AND THE DEFAULT IS FREE.
//
//   Tier A (default): ZERO live model invocations. Asks whether the engine
//   RECOGNISES an output style shipped inside a plugin, using `claude plugin
//   details`, whose entire job is to print a component inventory. Costs nothing
//   but process spawns.
//
//   Tier B (`--live`): behavioural probes — does a project-level style actually
//   change the register, does it compose with or override a project setting,
//   does it survive `--resume`. These need real turns and therefore real
//   budget, so they never run unless asked for explicitly.
//
// Tier A alone is decisive for the design's central question, because if a
// plugin cannot carry an output style at all then §L0 as written is not
// available and the alternative (the installer writing one into the project,
// as it already writes `CLAUDE.md` and `.claude/settings.json`) is a different
// design with a different owner-consent story.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude } from "./lib/cli.mjs";
import { verdict, writeVerdicts } from "./lib/verdict.mjs";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

/**
 * The child environment for a live arm, carrying an OAuth token if one is
 * available.
 *
 * `spikes/README.md` documents the handoff convention — export
 * `CLAUDE_CODE_OAUTH_TOKEN`, or write the token to `~/.claude/.eo-oauth-token`
 * (mode 0600) — and says every script "falls back to that file when no OAuth
 * token is available". This script did NOT, which is why its first two attempts
 * reported "not authenticated" on a host that had a handoff token sitting in
 * the documented place. The SDK-transport spikes implement the fallback; the
 * CLI-transport ones inherited `process.env` and nothing else.
 *
 * The token is never logged, never echoed, and never written anywhere.
 */
function liveEnv() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env;
  try {
    const token = readFileSync(join(homedir(), ".claude", ".eo-oauth-token"), "utf8").trim();
    if (token.length > 0) return { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
  } catch {
    /* no handoff file — fall through to whatever the CLI can resolve itself */
  }
  return process.env;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes("--live");
const entries = [];

/** Builds a scratch plugin directory carrying an output style plus `extra` components. */
function makePlugin(name, { withAgent = false, declareInManifest = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), `crabgic-spike11-${name}-`));
  const dir = join(root, "plug");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(dir, "output-styles"), { recursive: true });

  const manifest = { name, description: "output-style probe", version: "0.0.1" };
  if (declareInManifest) manifest.outputStyles = "./output-styles";
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "output-styles", "terse.md"),
    ["---", "name: Terse", "description: Answer-first, no preamble.", "---", "", "Answer first."].join(
      "\n",
    ),
    "utf8",
  );
  if (withAgent) {
    mkdirSync(join(dir, "agents"), { recursive: true });
    writeFileSync(
      join(dir, "agents", "noop.md"),
      ["---", "name: noop", "description: does nothing", "---", "", "noop"].join("\n"),
      "utf8",
    );
  }
  return { root, dir };
}

const scratch = [];
async function inventoryOf(name, options) {
  const { root, dir } = makePlugin(name, options);
  scratch.push(root);
  const result = await runClaude(["--plugin-dir", dir, "plugin", "details", name], {
    timeoutMs: 60000,
  });
  return result;
}

try {
  // ---------------------------------------------------------------- Tier A.1
  // A plugin carrying an output style AND a recognised component. If output
  // styles are a component category, the inventory names it.
  const withAgent = await inventoryOf("sp11a", { withAgent: true });
  const listsOutputStyle = /output[- ]?styles?\s*\(/i.test(withAgent.stdout);
  const loaded = /Component inventory/i.test(withAgent.stdout);

  entries.push(
    verdict({
      probe: "output-style.plugin-component-category",
      expectation:
        "`claude plugin details` enumerates an output style shipped in a plugin's output-styles/ directory, the way it enumerates skills, agents, hooks, MCP and LSP servers",
      observed: loaded
        ? listsOutputStyle
          ? "an output-style category IS listed in the component inventory"
          : `plugin loaded and inventory printed, but NO output-style category appears; categories seen: ${
              withAgent.stdout.match(/^\s{2}[A-Z][A-Za-z ]+\(\d+\)/gm)?.map((s) => s.trim()).join(", ") ??
              "(none parsed)"
            }`
        : `plugin did not load: ${withAgent.stderr.trim() || withAgent.stdout.trim()}`,
      verdict: !loaded ? "UNRESOLVED" : listsOutputStyle ? "PASS" : "FAIL",
      note: loaded && !listsOutputStyle
        ? "The inventory prints ZERO-count categories too, so absence is a positive signal rather than a display omission. `plugin details` is separately known to be warn-blind (engine-baseline §21), so this shows the style is not INVENTORIED; it does not by itself prove nothing loads it."
        : undefined,
    }),
  );

  // ---------------------------------------------------------------- Tier A.2
  // A plugin whose ONLY content is an output style. If the style contributed
  // anything at all, the always-on token cost would be non-zero.
  const styleOnly = await inventoryOf("sp11b", {});
  const alwaysOn = /Always-on:\s*~(\d+)\s*tok/i.exec(styleOnly.stdout);
  const tokens = alwaysOn ? Number(alwaysOn[1]) : null;

  entries.push(
    verdict({
      probe: "output-style.contributes-token-cost",
      expectation:
        "a plugin whose only content is an output style reports a non-zero always-on token cost, since a style that is loaded must occupy context",
      observed:
        tokens === null
          ? `could not parse an always-on figure from: ${styleOnly.stdout.trim().slice(0, 200)}`
          : `always-on cost is ~${String(tokens)} tok for a plugin containing only output-styles/terse.md`,
      verdict: tokens === null ? "UNRESOLVED" : tokens > 0 ? "PASS" : "FAIL",
      note:
        tokens === 0
          ? "Zero always-on cost for a plugin whose only file is an output style is the second independent signal that the engine does not load it."
          : undefined,
    }),
  );

  // ---------------------------------------------------------------- Tier A.3
  // Declaring the directory in the manifest — does the engine reject it, accept
  // it, or ignore it? A rejection would prove the key is KNOWN and misused.
  const declared = await inventoryOf("sp11c", { declareInManifest: true });
  const declaredListsStyle = /output[- ]?styles?\s*\(/i.test(declared.stdout);

  entries.push(
    verdict({
      probe: "output-style.manifest-key-recognised",
      expectation:
        "declaring `outputStyles` in plugin.json either registers the directory or is rejected as an unknown key — either answer identifies whether the key exists",
      // Reported as measured rather than classified. An earlier draft inferred
      // "rejected" from a non-zero exit code and printed an empty stderr beside
      // it, which read as evidence of a rejection that had not been observed.
      observed:
        `exit ${String(declared.code)}; stderr ${declared.stderr.trim() === "" ? "(empty)" : `"${declared.stderr.trim().slice(0, 160)}"`}; ` +
        `output-style category present in inventory: ${declaredListsStyle ? "yes" : "no"}`,
      verdict: "UNRESOLVED",
      note: "Neither outcome is a PASS or FAIL for the design question on its own. `plugin details` is warn-blind (engine-baseline §21), so silent acceptance discriminates nothing — it is recorded because a future engine that DOES reject the key would change this reading.",
    }),
  );

  // ---------------------------------------------------------------- Tier B
  if (!LIVE) {
    entries.push(
      verdict({
        probe: "output-style.changes-the-register",
        expectation:
          "a project-level output style measurably changes the assistant's default register, composes predictably with a project `outputStyle` setting, and survives --resume",
        observed: "NOT RUN — Tier B needs real turns and therefore real budget; re-run with --live to execute it",
        verdict: "UNRESOLVED",
        note: "Deliberately gated. Tier A is decisive for the plugin-shipping question and costs nothing; the behavioural half is only worth spending on once a delivery path exists.",
      }),
    );
  } else {
    // Behavioural probe: same prompt, with and without a project-level style
    // that demands a rare sentinel. The sentinel appearing only in the styled
    // arm is the observable proof the style reached the model.
    const SENTINEL = "OKAPI42";
    const projectRoot = mkdtempSync(join(tmpdir(), "crabgic-spike11-project-"));
    scratch.push(projectRoot);
    mkdirSync(join(projectRoot, ".claude", "output-styles"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".claude", "output-styles", "sentinel.md"),
      ["---", "name: Sentinel", "description: probe", "---", "", `Begin every reply with ${SENTINEL}.`].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(projectRoot, ".claude", "settings.json"),
      `${JSON.stringify({ outputStyle: "Sentinel" }, null, 2)}\n`,
      "utf8",
    );

    // A CONTROL ARM, in an identical project WITHOUT the style. Without it a
    // missing sentinel is ambiguous — "the style was ignored" and "print mode
    // ignores styles" and "the model just did not comply" are indistinguishable.
    // The discriminating observation is the DIFFERENCE between the two arms.
    const controlRoot = mkdtempSync(join(tmpdir(), "crabgic-spike11-control-"));
    scratch.push(controlRoot);
    mkdirSync(join(controlRoot, ".claude"), { recursive: true });
    writeFileSync(join(controlRoot, ".claude", "settings.json"), "{}\n", "utf8");

    const PROMPT = "Say the word ready.";
    const env = liveEnv();
    const styled = await runClaude(["-p", PROMPT], { cwd: projectRoot, env, timeoutMs: 120000 });
    const control = await runClaude(["-p", PROMPT], { cwd: controlRoot, env, timeoutMs: 120000 });

    const inStyled = styled.stdout.includes(SENTINEL);
    const inControl = control.stdout.includes(SENTINEL);

    // DID THE TURN ACTUALLY RUN? Checked before the sentinel is interpreted at
    // all. An earlier draft reported FAIL when both arms carried
    // "OAuth session expired" — recording, as an engine fact, that a style does
    // not work, on evidence that no turn had happened. A probe that cannot tell
    // "ran and the effect was absent" from "never ran" is worse than no probe,
    // because its output looks like a measurement.
    const failedToRun = [styled, control].map((arm) => {
      const text = `${arm.stdout}${arm.stderr}`;
      if (arm.timedOut) return "timed out";
      if (/OAuth|authenticate|not logged in|credential/i.test(text)) return "not authenticated";
      if (arm.code !== 0) return `exit ${String(arm.code)}`;
      if (text.trim().length === 0) return "no output";
      return null;
    });
    const blocked = failedToRun.find((reason) => reason !== null);

    entries.push(
      verdict({
        probe: "output-style.project-level-reaches-the-model",
        expectation: `a project-level .claude/output-styles/ entry selected by the outputStyle setting reaches the model: the sentinel ${SENTINEL} appears in the styled arm and not in the control arm`,
        observed: blocked
          ? `probe could not run (${blocked}): styled "${styled.stdout.trim().slice(0, 100)}" / control "${control.stdout.trim().slice(0, 100)}"`
          : `styled arm ${inStyled ? "CONTAINS" : "lacks"} the sentinel (${styled.stdout.trim().slice(0, 120)}); control arm ${inControl ? "CONTAINS" : "lacks"} it (${control.stdout.trim().slice(0, 120)})`,
        verdict: blocked
          ? "UNRESOLVED"
          : inStyled && !inControl
            ? "PASS"
            : inControl
              ? "UNRESOLVED"
              : "FAIL",
        note: blocked
          ? "No turn happened, so nothing about output styles was observed. Re-run after `claude setup-token` (or an interactive login) to obtain a verdict."
          : inControl
            ? "The sentinel appeared in the CONTROL arm too, so it did not come from the style; the probe cannot discriminate and needs a rarer sentinel."
            : inStyled
              ? undefined
              : "Neither arm carried the sentinel. Either the project-level style is not honoured, or `-p` print mode does not apply output styles — this probe cannot separate those two, and an interactive-transport variant would be needed to.",
      }),
    );
  }

  const outPath = join(__dirname, "fixtures", "11-output-style.verdicts.json");
  writeVerdicts(outPath, entries);
  console.log(`\nwrote ${String(entries.length)} verdict(s) to ${outPath}`);
} finally {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
}
