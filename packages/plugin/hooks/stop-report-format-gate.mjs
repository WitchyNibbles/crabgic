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
import { readFileSync } from "node:fs";

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
 * The width a wrapped manager report is assumed to occupy.
 *
 * WHY A CHARACTER BUDGET EXISTS AT ALL. `renderHumanReport` enforces
 * `proseBlockMaxLines` by counting newlines, which is exactly right for CLI
 * stdout: that stream is not re-wrapped, so a source line is a screen line. The
 * manager writes into a markdown-rendering TUI that DOES re-wrap, where the
 * commonest wall of all — one 900-character paragraph — contains no newline and
 * would sail past a line count while filling the screen.
 *
 * So the same limit needs a second spelling for the second channel. 80 columns
 * is the conservative choice: assuming a narrower terminal would make the gate
 * fire on paragraphs that render short and wide, which is the false-positive
 * direction this hook must stay out of.
 */
export const ASSUMED_WRAP_COLUMNS = 80;
export const PROSE_BLOCK_MAX_CHARS = PROSE_BLOCK_MAX_LINES * ASSUMED_WRAP_COLUMNS;

/** Lines that are structure, not prose — none of them can start a wall. */
const STRUCTURAL_LINE = /^\s*(?:[-*+•]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/;
const FENCE = /^\s*(?:```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const BULLET = /^\s*(?:[-*+•]\s|\d+[.)]\s)/;
const HEADING = /^\s*#{1,6}\s/;

/**
 * Splits a message into the paragraphs a reader actually has to wade through,
 * dropping everything that legitimately runs long.
 *
 * The exclusions are what make this safe to block on. A fenced code block, a
 * table, a blockquote and a bullet can each be arbitrarily long WITHOUT being
 * the defect this gate exists to catch — bullets and tables are the policy's
 * own preferred shapes, quoted text is not the author's prose at all, and code
 * is not prose in any sense. Flagging any of them would be a false positive on
 * a well-formed report, which is the one outcome worth engineering against.
 */
export function proseParagraphs(message) {
  const paragraphs = [];
  let current = [];
  let inFence = false;

  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
  };

  for (const line of message.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    // A structural line both ends the preceding paragraph and is not itself
    // prose — a paragraph that CONTINUES under a bullet belongs to the bullet.
    if (STRUCTURAL_LINE.test(line)) {
      flush();
      continue;
    }
    current.push(line.trim());
  }
  flush();
  return paragraphs;
}

/**
 * The non-empty lines that are actually PROSE — fenced content, tables,
 * headings, bullets and quotes all removed.
 *
 * Shares the fence/structure handling with `proseParagraphs` rather than
 * re-deriving it, because the two rules disagreeing about what counts as prose
 * is exactly how the code-block false positive got in.
 */
export function proseLines(message) {
  const kept = [];
  let inFence = false;
  for (const line of message.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim().length === 0) continue;
    if (STRUCTURAL_LINE.test(line)) continue;
    kept.push(line);
  }
  return kept;
}

/**
 * The rules. Two, both deliberately blunt.
 *
 * @returns an array of `{kind, detail}`; empty means the message is fine.
 */
export function findWalls(message) {
  if (typeof message !== "string" || message.trim().length === 0) return [];
  const walls = [];

  for (const paragraph of proseParagraphs(message)) {
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
  const lines = proseLines(message);
  const hasStructure = message
    .split("\n")
    .some((line) => HEADING.test(line) || BULLET.test(line) || TABLE_ROW.test(line));
  if (!hasStructure && lines.length > HEADING_REQUIRED_ABOVE_LINES) {
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
export function decideFormatAction(payload) {
  // §19.2 loop guard, checked FIRST and before the message is even read: if we
  // already blocked once, the model has had its instruction and the turn ends
  // regardless of whether the re-render satisfied us.
  if (payload?.stop_hook_active === true) return null;

  const message = payload?.last_assistant_message;
  if (typeof message !== "string" || message.trim().length === 0) return null;

  const walls = findWalls(message);
  if (walls.length === 0) return null;

  return { decision: "block", reason: buildBlockReason(walls) };
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

export function main({ read = readPayload, write = (s) => process.stdout.write(s) } = {}) {
  let payload;
  try {
    payload = read();
  } catch {
    return; // fail open
  }
  const decision = decideFormatAction(payload);
  if (decision !== null) write(JSON.stringify(decision));
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
