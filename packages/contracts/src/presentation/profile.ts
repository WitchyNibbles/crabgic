/**
 * Resolving which glyph profile a surface should render with —
 * `docs/presentation-policy.md` §"Profile resolution".
 *
 * Pure and dependency-free: the caller passes the environment and the
 * stream's TTY-ness rather than this module reaching for `process`, so it
 * is testable without mutating global state and safe to call from the
 * statusline's hot path.
 *
 * Precedence, highest first:
 *
 *   1. `CRABGIC_PRESENTATION=emoji|text|ascii` — explicit operator intent.
 *      An unrecognised value is IGNORED rather than fatal: a typo in a
 *      shell profile must degrade the display, never break a command.
 *   2. `CRABGIC_ASCII=1` — the blunt "my terminal has no Unicode" switch,
 *      matching `CRABGIC_STATUSLINE_ASCII`'s existing exactly-"1" contract.
 *   3. Not a TTY — piped, redirected or snapshot-captured. `text`, so
 *      golden output stays byte-stable and `| grep` keeps working.
 *   4. Otherwise `emoji` — a human is looking at this.
 *
 * `NO_COLOR` is deliberately NOT consulted. It governs colour, and a
 * reader who suppresses colour has not asked to lose the structural
 * markers that make a report scannable; conflating the two would strip
 * exactly the accessibility affordance this policy exists to provide.
 */
import { PRESENTATION_PROFILES, type PresentationProfile } from "./glyphs.js";

const KNOWN_PROFILES = new Set<string>(PRESENTATION_PROFILES);

function asProfile(value: string | undefined): PresentationProfile | undefined {
  return value !== undefined && KNOWN_PROFILES.has(value)
    ? (value as PresentationProfile)
    : undefined;
}

export interface PresentationProfileInput {
  /** Typically `process.env`. Read-only here — never mutated. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The target stream's `isTTY`. `process.stdout.isTTY` is `undefined` when piped; pass `false`. */
  readonly isTTY: boolean;
}

export function resolvePresentationProfile(input: PresentationProfileInput): PresentationProfile {
  const explicit = asProfile(input.env.CRABGIC_PRESENTATION);
  if (explicit !== undefined) return explicit;
  if (input.env.CRABGIC_ASCII === "1") return "ascii";
  return input.isTTY ? "emoji" : "text";
}

/**
 * Whether to emit colour, resolved independently of the glyph profile.
 *
 * The two decisions are deliberately separate. `NO_COLOR` means "no colour",
 * not "no structure", and a terminal with colour but no Unicode coverage is a
 * real configuration — so `ascii` output can still be coloured, and `emoji`
 * output can still be monochrome.
 *
 * Precedence, highest first:
 *
 *   1. `CRABGIC_COLOR=1|0` — explicit intent, and the only thing that can turn
 *      colour ON for a non-TTY. That case is real: piping into `less -R` or a
 *      CI log viewer that renders ANSI. An unrecognised value falls through
 *      rather than throwing, matching `CRABGIC_PRESENTATION`.
 *   2. `NO_COLOR`, however it is set — the cross-tool convention, checked by
 *      definedness exactly as `crabgic-statusline.mjs` already checks it.
 *   3. Not a TTY — never write escape bytes into a pipe, a snapshot or a log.
 *   4. Otherwise on.
 */
export function resolveColorEnabled(input: PresentationProfileInput): boolean {
  const explicit = input.env.CRABGIC_COLOR;
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  if (input.env.NO_COLOR !== undefined) return false;
  return input.isTTY;
}

/**
 * Everything a renderer needs, resolved once. A command handler resolves this
 * at its entry point and threads it through, so a single command's output can
 * never mix profiles or half-apply colour.
 */
export interface PresentationContext {
  readonly profile: PresentationProfile;
  readonly color: boolean;
}

export function resolvePresentation(input: PresentationProfileInput): PresentationContext {
  return {
    profile: resolvePresentationProfile(input),
    color: resolveColorEnabled(input),
  };
}
