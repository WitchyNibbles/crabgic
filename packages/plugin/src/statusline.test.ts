/**
 * Unit suite for the plugin's status-line renderer
 * (`../statusline/crabgic-statusline.mjs`).
 *
 * The renderer is a zero-dependency `.mjs` rather than compiled TypeScript
 * for the same reason `hooks/*.mjs` are: Claude Code re-runs the configured
 * `statusLine` command on every token/model/permission change (300ms
 * debounce), so process startup is on the hot path. A standalone script with
 * no imports beyond `node:child_process` starts in ~30ms; routing the same
 * work through the bundled `crabgic` CLI measured ~300ms, which is visibly
 * laggy in the TUI.
 *
 * Everything except the single `execFileSync` git call is a pure function, so
 * the whole line is asserted here without spawning a process or a terminal.
 * The payload shapes exercised below are the ones
 * `docs/engine-baseline.md` §17 records as really occurring — in particular
 * the cold-start shape (`context_window.used_percentage: null`, no
 * `rate_limits`) which is what every session shows before its first API
 * response.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  contextBar,
  formatResetCountdown,
  parseGitStatus,
  readGitStatus,
  renderStatusLine,
  shortModelName,
} from "../statusline/crabgic-statusline.mjs";

/** Fixed clock so every `resets_at` assertion is deterministic. */
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

/** A fully-populated payload: mid-session, subscriber, effort-capable model. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: "/repo",
    model: { id: "claude-opus-5[1m]", display_name: "Claude Opus 5 (1M context)" },
    workspace: { current_dir: "/repo", project_dir: "/repo" },
    context_window: { context_window_size: 1_000_000, used_percentage: 38 },
    effort: { level: "high" },
    fast_mode: false,
    thinking: { enabled: true },
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: NOW_S + 7300 },
      seven_day: { used_percentage: 41.2, resets_at: NOW_S + 250_000 },
    },
    ...overrides,
  };
}

/** Renders with colour off and a fixed clock — the readable form used by most assertions. */
function render(data: Record<string, unknown>, options: Record<string, unknown> = {}): string {
  return renderStatusLine(data, {
    nowMs: NOW_MS,
    color: false,
    git: { branch: "main", dirty: false },
    ...options,
  });
}

describe("shortModelName", () => {
  it("drops the redundant `Claude ` prefix", () => {
    expect(shortModelName("Claude Sonnet 5")).toBe("Sonnet 5");
  });

  it("compresses the extended-context suffix rather than dropping it", () => {
    expect(shortModelName("Claude Opus 5 (1M context)")).toBe("Opus 5 1M");
  });

  it("passes through a name that needs no shortening", () => {
    expect(shortModelName("Haiku 4.5")).toBe("Haiku 4.5");
  });

  it("falls back to a placeholder when display_name is missing", () => {
    expect(shortModelName(undefined)).toBe("claude");
    expect(shortModelName("")).toBe("claude");
  });
});

describe("contextBar", () => {
  it("fills proportionally and pads the remainder", () => {
    expect(contextBar(0, { color: false })).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(contextBar(50, { color: false })).toBe("▰▰▰▰▰▱▱▱▱▱");
    expect(contextBar(100, { color: false })).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("never overflows or underflows on out-of-range input", () => {
    expect(contextBar(-40, { color: false })).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(contextBar(400, { color: false })).toBe("▰▰▰▰▰▰▰▰▰▰");
  });

  it("uses ASCII cells when the ASCII fallback is requested", () => {
    expect(contextBar(30, { color: false, ascii: true })).toBe("###.......");
  });

  it("colours by heat band when colour is enabled", () => {
    expect(contextBar(95, { color: true })).toContain("[");
  });
});

describe("formatResetCountdown", () => {
  it("renders sub-hour windows in minutes", () => {
    expect(formatResetCountdown(NOW_S + 18 * 60, NOW_MS)).toBe("18m");
  });

  it("renders multi-hour windows as hours and minutes", () => {
    expect(formatResetCountdown(NOW_S + 2 * 3600 + 14 * 60, NOW_MS)).toBe("2h14m");
  });

  it("renders multi-day windows as days and hours", () => {
    expect(formatResetCountdown(NOW_S + 3 * 86_400 + 4 * 3600, NOW_MS)).toBe("3d4h");
  });

  it("returns null for a window that has already reset", () => {
    expect(formatResetCountdown(NOW_S - 60, NOW_MS)).toBeNull();
    expect(formatResetCountdown(NOW_S, NOW_MS)).toBeNull();
  });

  it("returns null for a non-finite timestamp", () => {
    expect(formatResetCountdown(Number.NaN, NOW_MS)).toBeNull();
  });
});

describe("parseGitStatus", () => {
  it("reads the branch from porcelain-v2 header lines", () => {
    const out = "# branch.oid abc123\n# branch.head feat/statusline\n";
    expect(parseGitStatus(out)).toEqual({ branch: "feat/statusline", dirty: false });
  });

  it("flags a dirty tree when any entry line follows the headers", () => {
    const out = "# branch.head main\n1 .M N... 100644 100644 100644 aaa bbb src/a.ts\n";
    expect(parseGitStatus(out)).toEqual({ branch: "main", dirty: true });
  });

  it("reports a detached HEAD as a null branch", () => {
    expect(parseGitStatus("# branch.head (detached)\n")).toEqual({ branch: null, dirty: false });
  });

  it("returns a null branch for output with no branch header", () => {
    expect(parseGitStatus("")).toEqual({ branch: null, dirty: false });
  });
});

/**
 * `readGitStatus` against real repositories — the branch is the one value
 * Claude Code does not put in the payload, so this is the only part of the
 * line that can fail for reasons outside the engine's control (no repo, no
 * git binary, detached HEAD). Each of those has to degrade to something
 * renderable rather than throwing into the TUI.
 */
describe("readGitStatus", () => {
  const created: string[] = [];

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "crabgic-statusline-git-"));
    created.push(dir);
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    };
    git("init", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    await writeFile(join(dir, "tracked.txt"), "one\n", "utf8");
    git("add", "tracked.txt");
    git("commit", "-m", "initial");
    return dir;
  }

  afterAll(async () => {
    for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("reads the current branch of a clean repository", async () => {
    expect(readGitStatus(await makeRepo())).toEqual({ branch: "main", dirty: false });
  });

  it("flags a modified tracked file as dirty", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "tracked.txt"), "two\n", "utf8");
    expect(readGitStatus(dir)).toEqual({ branch: "main", dirty: true });
  });

  it("ignores untracked files, which are noise rather than pending work", async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, "scratch.log"), "noise\n", "utf8");
    expect(readGitStatus(dir)).toEqual({ branch: "main", dirty: false });
  });

  it("falls back to a short sha on a detached HEAD", async () => {
    const dir = await makeRepo();
    execFileSync("git", ["checkout", "--detach", "HEAD"], { cwd: dir, stdio: "ignore" });
    const status = readGitStatus(dir);
    expect(status?.branch).toMatch(/^@[0-9a-f]{7,}$/);
  });

  it("returns null outside a repository rather than throwing into the TUI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crabgic-statusline-plain-"));
    created.push(dir);
    expect(readGitStatus(dir)).toBeNull();
  });

  it("falls back to the payload's worktree branch when git cannot answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crabgic-statusline-plain-"));
    created.push(dir);
    expect(readGitStatus(dir, "work/run1/task")).toEqual({
      branch: "work/run1/task",
      dirty: false,
    });
  });

  it("is what renderStatusLine reaches for when no git state is injected", async () => {
    const dir = await makeRepo();
    const line = renderStatusLine(
      { workspace: { current_dir: dir }, context_window: { used_percentage: 10 } },
      { color: false, nowMs: NOW_MS },
    );
    expect(line).toContain("⎇ main");
  });
});

describe("renderStatusLine — segment separation", () => {
  it("separates every value with a dedicated divider", () => {
    const line = render(payload());
    expect(line).toBe("🦀 Opus 5 1M·hi │ ⎇ main │ ▰▰▰▰▱▱▱▱▱▱ 38% │ 🕐 24% │ 📅 41%");
  });

  it("emits exactly one divider between each of the five values", () => {
    expect(render(payload()).split("│")).toHaveLength(5);
  });

  it("drops only the absent segments, keeping the rest separated", () => {
    const line = render(payload({ rate_limits: undefined }), { git: null });
    expect(line).toBe("🦀 Opus 5 1M·hi │ ▰▰▰▰▱▱▱▱▱▱ 38%");
  });
});

describe("renderStatusLine — model and reasoning effort", () => {
  it("fuses the model with its abbreviated effort level", () => {
    expect(render(payload({ effort: { level: "xhigh" } }))).toContain("Opus 5 1M·xh");
    expect(render(payload({ effort: { level: "medium" } }))).toContain("Opus 5 1M·md");
    expect(render(payload({ effort: { level: "max" } }))).toContain("Opus 5 1M·max");
  });

  it("omits the effort suffix for a model that does not support the parameter", () => {
    const line = render(payload({ effort: undefined }));
    expect(line).toContain("🦀 Opus 5 1M │");
    expect(line).not.toContain("·");
  });

  it("passes an unrecognised effort level through verbatim rather than dropping it", () => {
    expect(render(payload({ effort: { level: "ludicrous" } }))).toContain("·ludicrous");
  });

  it("marks fast mode on the model segment", () => {
    expect(render(payload({ fast_mode: true }))).toContain("Opus 5 1M·hi⚡");
  });
});

describe("renderStatusLine — git branch", () => {
  it("marks a dirty working tree", () => {
    expect(render(payload(), { git: { branch: "main", dirty: true } })).toContain("⎇ main*");
  });

  it("truncates an unreasonably long branch name", () => {
    const line = render(payload(), {
      git: { branch: "feat/a-really-very-long-branch-name-here", dirty: false },
    });
    expect(line).toContain("⎇ feat/a-really-very-lo…");
  });

  it("omits the branch segment entirely outside a git repository", () => {
    expect(render(payload(), { git: null })).not.toContain("⎇");
  });
});

describe("renderStatusLine — context window", () => {
  it("rounds the percentage and sizes the bar to match", () => {
    expect(render(payload({ context_window: { used_percentage: 91.4 } }))).toContain(
      "▰▰▰▰▰▰▰▰▰▱ 91%",
    );
  });

  it("renders an empty bar with a placeholder before the first API response", () => {
    const line = render(payload({ context_window: { used_percentage: null } }));
    expect(line).toContain("▱▱▱▱▱▱▱▱▱▱ --");
  });

  it("renders the placeholder when context_window is absent altogether", () => {
    expect(render(payload({ context_window: undefined }))).toContain("▱▱▱▱▱▱▱▱▱▱ --");
  });
});

describe("renderStatusLine — rate limits", () => {
  it("labels the 5-hour window with a clock and the weekly window with a calendar", () => {
    const line = render(payload());
    expect(line).toContain("🕐 24%");
    expect(line).toContain("📅 41%");
  });

  it("omits both windows before the first API response populates them", () => {
    const line = render(payload({ rate_limits: undefined }));
    expect(line).not.toContain("🕐");
    expect(line).not.toContain("📅");
  });

  it("omits a single window that is independently absent", () => {
    const line = render(
      payload({ rate_limits: { seven_day: { used_percentage: 12, resets_at: NOW_S + 900 } } }),
    );
    expect(line).not.toContain("🕐");
    expect(line).toContain("📅 12%");
  });

  it("reveals the reset countdown only once a window is nearly exhausted", () => {
    const line = render(
      payload({
        rate_limits: {
          five_hour: { used_percentage: 87, resets_at: NOW_S + 4560 },
          seven_day: { used_percentage: 41, resets_at: NOW_S + 250_000 },
        },
      }),
    );
    expect(line).toContain("🕐 87%↻1h16m");
    expect(line).toContain("📅 41%");
    expect(line).not.toContain("📅 41%↻");
  });

  it("suppresses the countdown when the window has already reset", () => {
    const line = render(
      payload({ rate_limits: { five_hour: { used_percentage: 99, resets_at: NOW_S - 1 } } }),
    );
    expect(line).toContain("🕐 99%");
    expect(line).not.toContain("↻");
  });

  it("ignores a window carrying a non-numeric percentage", () => {
    const line = render(payload({ rate_limits: { five_hour: { used_percentage: null } } }));
    expect(line).not.toContain("🕐");
  });
});

describe("renderStatusLine — degraded terminals", () => {
  it("renders an ASCII-only line with no colour", () => {
    const line = render(payload(), { ascii: true });
    expect(line).toBe(":: Opus 5 1M·hi | git: main | ####...... 38% | 5h 24% | wk 41%");
  });

  it("emits ANSI sequences when colour is enabled and none when it is not", () => {
    expect(render(payload(), { color: true })).toContain("[");
    expect(render(payload(), { color: false })).not.toContain("[");
  });

  it("still renders a usable line from an entirely empty payload", () => {
    const line = render({}, { git: null });
    expect(line).toBe("🦀 claude │ ▱▱▱▱▱▱▱▱▱▱ --");
  });
});
