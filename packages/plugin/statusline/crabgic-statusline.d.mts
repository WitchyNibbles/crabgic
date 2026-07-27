/**
 * Type declarations for `./crabgic-statusline.mjs`.
 *
 * The renderer is authored as plain `.mjs` rather than compiled TypeScript
 * because the engine re-runs it on every token change and process startup is
 * on the hot path (see the module's own header). This file is what lets the
 * TypeScript build still type-check the suite that covers it.
 */

/** The subset of Claude Code's status-line payload this renderer reads. Full contract: `docs/engine-baseline.md` §17. */
export interface StatusLinePayload {
  readonly cwd?: string;
  readonly model?: { readonly id?: string; readonly display_name?: string };
  readonly workspace?: { readonly current_dir?: string; readonly project_dir?: string };
  readonly worktree?: { readonly branch?: string };
  /** `used_percentage` is `null` before the first API response and again after `/compact`. */
  readonly context_window?: {
    readonly context_window_size?: number;
    readonly used_percentage?: number | null;
  };
  /** Absent entirely when the current model does not support the reasoning-effort parameter. */
  readonly effort?: { readonly level?: string };
  readonly fast_mode?: boolean;
  readonly thinking?: { readonly enabled?: boolean };
  /** Present only for Claude.ai subscribers, and only after the first API response. Each window is independently optional. */
  readonly rate_limits?: {
    readonly five_hour?: RateLimitWindow;
    readonly seven_day?: RateLimitWindow;
  };
}

export interface RateLimitWindow {
  readonly used_percentage?: number | null;
  /** Unix epoch seconds. */
  readonly resets_at?: number;
}

export interface GitState {
  readonly branch: string | null;
  readonly dirty: boolean;
}

export interface RenderOptions {
  /** Injected so the renderer is pure under test; defaults to `Date.now()`. */
  readonly nowMs?: number;
  readonly color?: boolean;
  readonly ascii?: boolean;
  /** Injected git state; defaults to reading it from the payload's working directory. `null` renders no branch segment. */
  readonly git?: GitState | null;
}

export interface BarOptions {
  readonly color?: boolean;
  readonly ascii?: boolean;
}

export function shortModelName(displayName: string | undefined): string;
export function contextBar(percentage: number, options?: BarOptions): string;
export function formatResetCountdown(resetsAtSeconds: number, nowMs: number): string | null;
export function parseGitStatus(stdout: string): GitState;
export function readGitStatus(cwd: string, worktreeBranch?: string): GitState | null;
export function renderStatusLine(data: StatusLinePayload, options?: RenderOptions): string;
