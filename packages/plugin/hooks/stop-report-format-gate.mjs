#!/usr/bin/env node
/**
 * The manager REPORT-FORMAT gate — a blocking `Stop` hook.
 *
 * WHAT IT DOES. When the manager session tries to end a turn, this hook reads
 * the message it is about to end on and refuses the stop if that message is a
 * wall: one enormous paragraph, or a long answer with no headings and no
 * bullets. The refusal reason tells the model to re-render it answer-first.
 *
 * WHY IT EXISTS. `src/manager-protocol.ts` carries the reporting rules, and
 * `docs/presentation-policy.md` recorded that they were enforceable only for
 * CLI stdout: "Prose is not enforcement ... there is no equivalent of the
 * `stop-autonomy-gate.mjs` hook for formatting, because there is no
 * deterministic signal to hang one on."
 *
 * THAT WAS TRUE OF RUN STATE AND FALSE OF FORMATTING, and this hook is the
 * correction. `docs/engine-baseline.md` §19.3 — probe-verified at engine
 * 2.1.220, and written before this hook was conceived — records that the `Stop`
 * payload carries `last_assistant_message`, and flags it as "the field a
 * regex-classifying gate would key on". The autonomy gate rightly declines to
 * use it: whether a run is in flight is something the supervisor KNOWS, so
 * pattern-matching prose for it would be guessing at an answer already
 * available. Formatting is the opposite case. It is a property OF the text, so
 * the text is not a proxy for the signal — it IS the signal.
 *
 * ENGINE CONTRACT (`docs/engine-baseline.md` §19, probe `spikes/10-stop-hook.mjs`,
 * verified at engine 2.1.220):
 *   - §19.1 `{"decision":"block","reason":R}` on stdout prevents the turn
 *     ending, and R reaches the model as its next instruction.
 *   - §19.2 `stop_hook_active` is `true` on the re-entered Stop event — the
 *     loop guard, and the reason this hook can never wedge a session.
 *   - §19.3 the payload carries `last_assistant_message`.
 *
 * FALSE POSITIVES ARE THE EXPENSIVE FAILURE, and this hook is tuned around
 * that. It runs on every session end in every project with the plugin
 * installed. A missed wall costs one hard-to-read answer. A wrongly-blocked
 * turn costs a wasted round trip on a report that was already fine — and, worse,
 * teaches the owner to distrust the gate. So: two rules only, both unambiguous;
 * every construct that legitimately runs long is exempt; and every error,
 * absent field or unparseable input allows the stop.
 *
 * IT BLOCKS AT MOST ONCE PER TURN, by §19.2. If the re-render is still over
 * budget the turn ends anyway. This gate's job is to catch the reflex wall, not
 * to hold the model hostage to a formatter.
 */
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { proseLinesOf, proseParagraphsOf, hasStructure } from "./lib/block-tokenizer.mjs";

/**
 * Mirrors `HUMAN_REPORT_LIMITS` in `@crabgic/contracts`
 * (`src/presentation/presentation-policy.ts`). This file is a plain `.mjs`
 * loaded directly by the engine and cannot import the workspace package, so the
 * values are restated here and a parity test (`src/stop-report-format-gate.test.ts`)
 * fails if they ever drift — the same arrangement `stop-autonomy-gate.mjs` has
 * with `RUN_LIFECYCLE_STATES`.
 */
export const PROSE_BLOCK_MAX_LINES = 3;
export const HEADING_REQUIRED_ABOVE_LINES = 5;

/**
 * The longest single paragraph, in characters — mirrors `proseBlockMaxChars` in
 * `@crabgic/contracts`, and the parity test fails on drift.
 *
 * WHY A CHARACTER BUDGET EXISTS AT ALL. `renderHumanReport` enforces
 * `proseBlockMaxLines` by counting newlines, which is right for CLI stdout: that
 * stream is not re-wrapped, so a source line is a screen line. The manager
 * writes into a markdown TUI that DOES re-wrap, where the commonest wall of all
 * — one 900-character paragraph — holds no newline and would sail past a line
 * count while filling the screen.
 *
 * WHY 320 AND NOT A DERIVATION. This was `3 lines x an assumed 80 columns` =
 * 240, which is a guess wearing a derivation's clothes, and it was badly wrong:
 * measured against 1,878 real messages from this owner's transcripts, 240 would
 * have refused 69% of them — the median paragraph is 228, so the line ran
 * straight through the middle of ordinary writing. 320 is CALIBRATED: the owner
 * read four real paragraphs of increasing size from their own logs and put the
 * wall between 230 and 330. It is set just under the first one they called a
 * wall, which is the conservative side of their own judgement.
 */
export const PROSE_BLOCK_MAX_CHARS = 320;

/**
 * The rules. Two, both deliberately blunt.
 *
 * @returns an array of `{kind, detail}`; empty means the message is fine.
 */
export function findWalls(message) {
  if (typeof message !== "string" || message.trim().length === 0) return [];
  const walls = [];

  for (const paragraph of proseParagraphsOf(message)) {
    if (paragraph.length > PROSE_BLOCK_MAX_CHARS) {
      walls.push({
        kind: "prose-block",
        detail:
          `a ${String(paragraph.length)}-character paragraph, over the ` +
          `${String(PROSE_BLOCK_MAX_CHARS)}-character budget`,
      });
      break; // One is enough to make the point; the reason stays short.
    }
  }

  // A message can clear the paragraph rule and still be a wall by accumulation:
  // a dozen short prose lines, no heading, no bullet, nothing to land on after
  // a lapse in attention.
  //
  // COUNTED OVER PROSE ONLY. Counting every non-empty line instead — which this
  // did until review — meant a five-line code block pushed an ordinary "here is
  // the fix: <code>" answer over the threshold and blocked it. That shape is
  // among the commonest a coding assistant produces, and a blocking hook that
  // reds it is worse than no hook at all. Fenced content is not prose the reader
  // has to wade through; it is the thing they asked for.
  const lines = proseLinesOf(message);
  if (!hasStructure(message) && lines.length > HEADING_REQUIRED_ABOVE_LINES) {
    walls.push({
      kind: "no-structure",
      detail:
        `${String(lines.length)} lines with no heading, bullet or table, over the ` +
        `${String(HEADING_REQUIRED_ABOVE_LINES)}-line threshold`,
    });
  }

  return walls;
}

/**
 * The pure decision. Exported so the whole rule set is testable without an
 * engine.
 *
 * @returns `null` to allow the turn to end, or a block decision object.
 */
export function decideFormatAction(payload, config = DEFAULT_GATE_CONFIG) {
  // §19.2 loop guard, checked FIRST and before the message is even read: if we
  // already blocked once, the model has had its instruction and the turn ends
  // regardless of whether the re-render satisfied us.
  if (payload?.stop_hook_active === true) return null;
  if (config?.enabled === false) return null;

  const message = payload?.last_assistant_message;
  if (typeof message !== "string" || message.trim().length === 0) return null;

  const walls = findWalls(message);
  if (walls.length === 0) return null;

  // ADVISORY records and lets the turn end. `docs/design/format-gate-production.md`
  // §4: this gate shipped blocking on thresholds nobody had measured, and the
  // rollout that should have happened is observe → calibrate → block. Advisory
  // is what lets a project run the observing phase without a second code path.
  if (config?.mode === "advisory") return { advisory: true, walls };

  return { decision: "block", reason: buildBlockReason(walls) };
}

/**
 * What the gate does when no project config is found. Mirrors
 * `DEFAULT_FORMAT_GATE` in `@crabgic/contracts`, and the parity test asserts it.
 *
 * ADVISORY, not blocking. It shipped blocking on a guessed budget that would
 * have refused 69% of 1,878 real messages; even at the owner-calibrated budget
 * it refuses 44%. Those are pre-prevention numbers — the output style
 * (engine-baseline §23.4) exists to lower them at the source — so the honest
 * order is observe, measure the post-style rate, then decide about blocking.
 */
export const DEFAULT_GATE_CONFIG = Object.freeze({ enabled: true, mode: "advisory" });

/**
 * Reads `.crabgic/presentation.json`'s `formatGate` member.
 *
 * A trimmed re-implementation of `loadPresentationPolicy`, for the same reason
 * the limits are restated here: this is a plain `.mjs` the engine loads
 * directly and it cannot import the workspace package. It reads ONLY the two
 * switches — an unreadable or malformed file yields the default, never a
 * throw, and never a half-applied config.
 */
export function readGateConfig(projectRoot, read = readFileSync) {
  try {
    const raw = read(join(projectRoot, ".crabgic", "presentation.json"), "utf8");
    const parsed = JSON.parse(raw);
    const gate = parsed?.formatGate;
    if (typeof gate !== "object" || gate === null) return DEFAULT_GATE_CONFIG;
    return {
      enabled: typeof gate.enabled === "boolean" ? gate.enabled : DEFAULT_GATE_CONFIG.enabled,
      mode:
        gate.mode === "advisory" || gate.mode === "blocking" ? gate.mode : DEFAULT_GATE_CONFIG.mode,
    };
  } catch {
    return DEFAULT_GATE_CONFIG;
  }
}

/**
 * The `reason`, which §19.1 confirms reaches the model as its next
 * instruction. It has to say what is wrong, why it matters, and what to do —
 * and it has to be SHORT, because a gate that lectures about brevity in four
 * paragraphs has refuted itself.
 */
export function buildBlockReason(walls) {
  const found = walls.map((wall) => wall.detail).join("; ");
  return (
    `That report is hard to read: ${found}. The owner has a condition that makes ` +
    `long unordered prose very hard to parse, so this is an accessibility ` +
    `requirement, not a style note. Send it again, same content, restructured: ` +
    `the answer in the first line, \`##\` headings past ${String(HEADING_REQUIRED_ABOVE_LINES)} lines, ` +
    `bullets instead of paragraphs, and a table once several items each carry ` +
    `two or more attributes. Do not apologise or explain the reformat — just ` +
    `give the restructured answer.`
  );
}

/** Reads the hook payload. Any failure yields `{}` — "cannot determine" resolves to "allow the stop". */
export function readPayload(readFd = () => readFileSync(0, "utf8")) {
  try {
    const raw = readFd();
    if (typeof raw !== "string" || raw.trim().length === 0) return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Appends one firing to the telemetry log, or does nothing it cannot do.
 *
 * WHY A DIGEST AND NOT THE TEXT. This records that a rule fired and how far
 * over budget it was — never what the owner's session said. A gate that quietly
 * accumulated transcript prose on disk would be a worse problem than the one it
 * solves.
 *
 * DELIBERATELY NOT THE JOURNAL. The journal has no writer identity, so anything
 * appended there carries an integrity claim this file cannot honour. A plain
 * append-only counter file with no security claim attached is the honest home;
 * `docs/design/format-gate-production.md` §L3 records the reasoning.
 */
export function recordFiring(entry, deps = {}) {
  const {
    stateHome = process.env.XDG_STATE_HOME || join(process.env.HOME ?? ".", ".local", "state"),
    append = appendFileSync,
    mkdir = mkdirSync,
  } = deps;
  try {
    const dir = join(stateHome, "crabgic");
    mkdir(dir, { recursive: true });
    append(join(dir, "format-gate.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* telemetry must never affect the turn */
  }
}

/** A stable, non-reversing fingerprint of the message — for de-duplicating firings, not for reading. */
function digestOf(message) {
  return createHash("sha256").update(message).digest("hex").slice(0, 16);
}

export function main({
  read = readPayload,
  write = (s) => process.stdout.write(s),
  config = undefined,
  record = recordFiring,
  now = () => new Date().toISOString(),
} = {}) {
  let payload;
  try {
    payload = read();
  } catch {
    return; // fail open
  }

  const cwd =
    typeof payload?.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const gate = config ?? readGateConfig(cwd);
  const decision = decideFormatAction(payload, gate);
  if (decision === null) return;

  // Guarded HERE as well as inside `recordFiring`. The production sink catches
  // its own I/O errors, but the decision must survive any sink — a telemetry
  // failure that swallowed a block, or threw past the caller, would let
  // observability change behaviour, which is exactly backwards.
  const message = payload?.last_assistant_message ?? "";
  try {
    record({
      at: now(),
      mode: gate.mode,
      rules: decision.walls?.map((w) => w.kind) ?? findWalls(message).map((w) => w.kind),
      details: decision.walls?.map((w) => w.detail) ?? undefined,
      messageDigest: digestOf(message),
    });
  } catch {
    /* never let observability affect the turn */
  }

  // Advisory records and stays silent, so the turn ends normally.
  if (decision.advisory === true) return;
  write(JSON.stringify({ decision: decision.decision, reason: decision.reason }));
}

// Only run when executed as the hook, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch {
    /* fail open: never let this hook's own failure trap a session */
  }
  process.exitCode = 0;
}
