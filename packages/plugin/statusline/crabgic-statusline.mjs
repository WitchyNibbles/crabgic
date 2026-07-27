#!/usr/bin/env node
/**
 * Crabgic's Claude Code status line — roadmap/10-plugin-and-installer.md
 * §In scope, "Distribution". Renders, left to right and each value clearly
 * divided from the next:
 *
 *   🦀 Opus 5 1M·hi │ ⎇ main* │ ▰▰▰▰▱▱▱▱▱▱ 38% │ 🕐 24% │ 📅 41%
 *     model·effort      branch     context window     5-hour    weekly
 *
 * Claude Code pipes the session JSON on stdin and renders stdout. The payload
 * contract this file reads is recorded in `docs/engine-baseline.md` §17,
 * verified against engine 2.1.220 — do not widen it from memory.
 *
 * Zero dependencies and no `@crabgic/*` imports on purpose: the engine
 * re-runs this command on every model/permission/token change (300ms
 * debounce), so process startup is on the hot path. Standalone it starts in
 * ~30ms; the same logic reached through the bundled `crabgic` CLI measured
 * ~300ms, which reads as lag in the TUI. This is the same reasoning that
 * keeps `hooks/*.mjs` standalone.
 *
 * Every value degrades independently: a segment whose data is absent is
 * dropped rather than rendered empty, because two of them genuinely are
 * absent at session start (see §17.1's nullability notes).
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Cells in the context-window meter. */
const BAR_WIDTH = 10;
/** Longest branch name rendered before it is elided. */
const MAX_BRANCH = 22;
/** Rate-limit utilisation at or above which the reset countdown is revealed. */
const COUNTDOWN_THRESHOLD = 80;

const UNICODE_GLYPHS = {
  crab: "\u{1F980}",
  branch: "⎇",
  full: "▰",
  empty: "▱",
  separator: " │ ",
  reset: "↻",
  fiveHour: "🕐",
  sevenDay: "📅",
  fastMode: "⚡",
};

/**
 * Fallback glyphs for terminals/fonts without emoji or ambiguous-width
 * coverage. "ASCII" here means "no emoji, no double-width cells" rather than
 * strictly 7-bit: the `·` joining model to effort is kept, because `.` or `-`
 * in that position reads as part of the model name.
 */
const ASCII_GLYPHS = {
  crab: "::",
  branch: "git:",
  full: "#",
  empty: ".",
  separator: " | ",
  reset: "~",
  fiveHour: "5h",
  sevenDay: "wk",
  fastMode: "!",
};

const EFFORT_ABBREVIATIONS = { low: "lo", medium: "md", high: "hi", xhigh: "xh", max: "max" };

const COLORS = {
  dim: "38;5;242",
  model: "38;5;180",
  effort: "38;5;146",
  branch: "38;5;110",
  dirty: "38;5;214",
  fastMode: "38;5;220",
  calm: "38;5;114",
  warm: "38;5;179",
  hot: "38;5;214",
  critical: "38;5;203",
};

function glyphs(ascii) {
  return ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

function paint(code, text, color) {
  return color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/** Colour band for a 0–100 utilisation figure, shared by all three meters so they read as one scale. */
function heatColor(percentage) {
  if (percentage >= 90) return COLORS.critical;
  if (percentage >= 70) return COLORS.hot;
  if (percentage >= 40) return COLORS.warm;
  return COLORS.calm;
}

/** `"Claude Opus 5 (1M context)"` → `"Opus 5 1M"`. The extended-context marker is compressed, never dropped — which engine a session is on is the point of showing the model at all. */
export function shortModelName(displayName) {
  if (typeof displayName !== "string" || displayName.trim() === "") return "claude";
  return displayName
    .replace(/^Claude\s+/i, "")
    .replace(/\s*\(1M context\)\s*/i, " 1M")
    .replace(/\s+/g, " ")
    .trim();
}

/** A `BAR_WIDTH`-cell meter for `percentage`, clamped so a malformed figure can never change the line's width. */
export function contextBar(percentage, options = {}) {
  const { color = false, ascii = false } = options;
  const glyph = glyphs(ascii);
  const ratio = Number.isFinite(percentage) ? percentage / 100 : 0;
  const filled = Math.min(BAR_WIDTH, Math.max(0, Math.round(ratio * BAR_WIDTH)));
  return (
    paint(heatColor(percentage), glyph.full.repeat(filled), color) +
    paint(COLORS.dim, glyph.empty.repeat(BAR_WIDTH - filled), color)
  );
}

/** Compact time until a rate-limit window resets (`"18m"`, `"2h14m"`, `"3d4h"`), or `null` if it already has. */
export function formatResetCountdown(resetsAtSeconds, nowMs) {
  const remaining = Math.round(resetsAtSeconds - nowMs / 1000);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

/**
 * Extracts branch + dirtiness from `git status --porcelain=v2 --branch`
 * output. Split out from the spawn so the parsing — the part with the
 * detached-HEAD and clean/dirty branches — is testable without a repository.
 */
export function parseGitStatus(stdout) {
  let branch = null;
  let dirty = false;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      branch = head === "(detached)" ? null : head;
    } else if (line !== "" && !line.startsWith("#")) {
      dirty = true;
    }
  }
  return { branch, dirty };
}

/**
 * The one impure segment: the branch is NOT in the status-line payload
 * (`workspace.repo` carries only host/owner/name — see engine-baseline §17.1),
 * so it has to come from git. One spawn covers both branch and dirtiness;
 * `--no-optional-locks` keeps a status line from contending for `index.lock`
 * with the user's own commands, and the timeouts keep a pathological repo
 * from stalling the TUI.
 */
export function readGitStatus(cwd, worktreeBranch) {
  const run = (args, timeout) =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "ignore"],
    });
  try {
    const status = parseGitStatus(run(["status", "--porcelain=v2", "--branch", "-uno"], 900));
    if (status.branch !== null) return status;
    // Detached HEAD: a short sha is more use than an empty segment.
    const sha = run(["rev-parse", "--short", "HEAD"], 500).trim();
    return { branch: `@${sha}`, dirty: status.dirty };
  } catch {
    // Not a repo, git absent, or too slow. A worktree payload still knows its
    // own branch, so fall back to that before giving up on the segment.
    return typeof worktreeBranch === "string" ? { branch: worktreeBranch, dirty: false } : null;
  }
}

function modelSegment(data, glyph, color) {
  const name = paint(COLORS.model, shortModelName(data.model?.display_name), color);
  const level = data.effort?.level;
  const effort =
    typeof level === "string"
      ? paint(COLORS.dim, "·", color) +
        paint(COLORS.effort, EFFORT_ABBREVIATIONS[level] ?? level, color)
      : "";
  const fast = data.fast_mode === true ? paint(COLORS.fastMode, glyph.fastMode, color) : "";
  return `${glyph.crab} ${name}${effort}${fast}`;
}

function branchSegment(git, glyph, color) {
  if (git === null || git === undefined || typeof git.branch !== "string") return null;
  const label =
    git.branch.length > MAX_BRANCH ? `${git.branch.slice(0, MAX_BRANCH - 1)}…` : git.branch;
  return (
    paint(COLORS.dim, glyph.branch, color) +
    " " +
    paint(COLORS.branch, label, color) +
    (git.dirty ? paint(COLORS.dirty, "*", color) : "")
  );
}

function contextSegment(data, glyph, color, ascii) {
  const used = data.context_window?.used_percentage;
  // `null` until the first API response of a session, and again after
  // `/compact` — a placeholder keeps the line's shape stable across that.
  if (typeof used !== "number") {
    return `${contextBar(0, { color, ascii })} ${paint(COLORS.dim, "--", color)}`;
  }
  const percentage = Math.round(used);
  return `${contextBar(percentage, { color, ascii })} ${paint(heatColor(percentage), `${percentage}%`, color)}`;
}

function rateLimitSegment(label, window, glyph, color, nowMs) {
  if (window === null || window === undefined) return null;
  if (typeof window.used_percentage !== "number") return null;
  const percentage = Math.round(window.used_percentage);
  let segment =
    paint(COLORS.dim, label, color) + " " + paint(heatColor(percentage), `${percentage}%`, color);
  // Progressive disclosure: the countdown only earns its width once the
  // window is close enough to exhaustion for the reset time to matter.
  if (percentage >= COUNTDOWN_THRESHOLD && typeof window.resets_at === "number") {
    const countdown = formatResetCountdown(window.resets_at, nowMs);
    if (countdown !== null) segment += paint(COLORS.dim, `${glyph.reset}${countdown}`, color);
  }
  return segment;
}

/**
 * Renders the whole line. `options.git` is injected so the entire renderer is
 * pure under test; production passes the result of `readGitStatus`.
 */
export function renderStatusLine(data, options = {}) {
  const {
    nowMs = Date.now(),
    color = false,
    ascii = false,
    git = readGitStatus(
      data.workspace?.current_dir ?? data.cwd ?? process.cwd(),
      data.worktree?.branch,
    ),
  } = options;
  const glyph = glyphs(ascii);

  const segments = [
    modelSegment(data, glyph, color),
    branchSegment(git, glyph, color),
    contextSegment(data, glyph, color, ascii),
    rateLimitSegment(glyph.fiveHour, data.rate_limits?.five_hour, glyph, color, nowMs),
    rateLimitSegment(glyph.sevenDay, data.rate_limits?.seven_day, glyph, color, nowMs),
  ].filter((segment) => segment !== null);

  return segments.join(paint(COLORS.dim, glyph.separator, color));
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let data = {};
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // A malformed payload still yields a useful line from defaults.
  }
  const color = process.env.NO_COLOR === undefined && process.env.CRABGIC_STATUSLINE_COLOR !== "0";
  const ascii = process.env.CRABGIC_STATUSLINE_ASCII === "1";
  process.stdout.write(`${renderStatusLine(data, { color, ascii })}\n`);
}

/**
 * True when this module is the process entry point.
 *
 * `process.argv[1]` is the path AS INVOKED, but `import.meta.url` is the
 * REAL path — Node resolves symlinks for module identity. Comparing the two
 * directly makes a symlinked invocation look like a plain import, so `main()`
 * silently never runs: exit 0, empty stdout, no error, and Claude Code
 * renders a blank status row with nothing to debug. 1.1.0 shipped that way.
 * Resolving argv[1] first is what makes both invocations agree.
 */
function isEntryPoint() {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    // argv[1] names something unresolvable — not this module either way.
    return false;
  }
}

/* c8 ignore start -- executable entry point; covered by the spawning tests in ../src/statusline.test.ts, whose subprocess coverage v8 cannot attribute back here. */
if (isEntryPoint()) {
  await main();
}
/* c8 ignore stop */
