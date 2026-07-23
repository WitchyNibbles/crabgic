/**
 * xdg-consistency (03<->04 seam carry-forward, engine-core's `xdg-default-
 * paths.ts` doc comment: "Once phases 04 (`@eo/journal`) and 05/06 (this
 * package's consumers) are both linked, 05/06 must add a consistency test
 * proving these defaults never silently diverge from `@eo/journal`'s real
 * runtime-resolved roots"). engine-core's compiled, MANDATORY sandbox
 * `denyRead` tilde literals (`~/.local/state/engineering-orchestrator/**`,
 * `~/.cache/engineering-orchestrator/**`) — read from a REAL compiled
 * canonical profile, not the standalone constants in isolation — must stay
 * consistent with `@eo/journal`'s own exported XDG layout constants/
 * functions under an unset-`$XDG_STATE_HOME`/`$XDG_CACHE_HOME` env
 * resolution (the XDG Base Directory spec's own documented default:
 * `~/.local/state`/`~/.cache`).
 */
import { describe, expect, it } from "vitest";
import {
  compileEnvelope,
  READ_ONLY_ENVELOPE,
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
} from "@eo/engine-core";
import {
  resolveXdgStateHome,
  resolveXdgCacheHome,
  ENGINEERING_ORCHESTRATOR_DIR_NAME,
  type XdgEnv,
} from "@eo/journal";

const UNSET_XDG_ENV: XdgEnv = { HOME: "/home/testuser" };

describe("engine-core's compiled mandatory denyRead tilde literals appear in a real compiled profile", () => {
  it("compileEnvelope(READ_ONLY_ENVELOPE)'s sandbox.filesystem.denyRead includes both tilde literals verbatim", () => {
    const profile = compileEnvelope(READ_ONLY_ENVELOPE);
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_STATE_ROOT_DENY_PATH);
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_CACHE_ROOT_DENY_PATH);
  });
});

describe("engine-core's tilde-anchored defaults stay consistent with @eo/journal's XDG resolution (unset $XDG_STATE_HOME/$XDG_CACHE_HOME)", () => {
  it("CONTROL_REPO_STATE_ROOT_DENY_PATH, with '~' expanded to HOME, equals journal's own resolveXdgStateHome + ENGINEERING_ORCHESTRATOR_DIR_NAME", () => {
    const expected = `${resolveXdgStateHome(UNSET_XDG_ENV)}/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/**`;
    const actual = CONTROL_REPO_STATE_ROOT_DENY_PATH.replace(/^~/, UNSET_XDG_ENV.HOME);
    expect(actual).toBe(expected);
    // Sanity on the XDG spec's own documented default itself.
    expect(resolveXdgStateHome(UNSET_XDG_ENV)).toBe(`${UNSET_XDG_ENV.HOME}/.local/state`);
  });

  it("CONTROL_REPO_CACHE_ROOT_DENY_PATH, with '~' expanded to HOME, equals journal's own resolveXdgCacheHome + ENGINEERING_ORCHESTRATOR_DIR_NAME", () => {
    const expected = `${resolveXdgCacheHome(UNSET_XDG_ENV)}/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/**`;
    const actual = CONTROL_REPO_CACHE_ROOT_DENY_PATH.replace(/^~/, UNSET_XDG_ENV.HOME);
    expect(actual).toBe(expected);
    expect(resolveXdgCacheHome(UNSET_XDG_ENV)).toBe(`${UNSET_XDG_ENV.HOME}/.cache`);
  });

  it("a non-default $XDG_STATE_HOME override is NOT reflected by engine-core's tilde literal (documented divergence, not a bug: 03 cannot depend on 04 — see xdg-default-paths.ts's own seam-decision doc comment)", () => {
    const overriddenEnv: XdgEnv = { HOME: "/home/testuser", XDG_STATE_HOME: "/custom/state/root" };
    const journalStateRoot = resolveXdgStateHome(overriddenEnv);
    const engineCoreTildeExpansion = CONTROL_REPO_STATE_ROOT_DENY_PATH.replace(
      /^~/,
      overriddenEnv.HOME,
    );
    // journal correctly honors the override; engine-core's own default,
    // built at phase-03 time before phase 04 existed to depend on, does
    // not track it — this is the exact carried-forward gap the seam
    // decision names, not a silent, undetected drift.
    expect(journalStateRoot).toBe("/custom/state/root");
    expect(engineCoreTildeExpansion).not.toBe(
      `${journalStateRoot}/${ENGINEERING_ORCHESTRATOR_DIR_NAME}/**`,
    );
  });
});
