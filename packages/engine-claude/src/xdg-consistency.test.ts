/**
 * xdg-consistency (03<->04 seam carry-forward, engine-core's `xdg-default-
 * paths.ts` doc comment: "Once phases 04 (`@crabgic/journal`) and 05/06 (this
 * package's consumers) are both linked, 05/06 must add a consistency test
 * proving these defaults never silently diverge from `@crabgic/journal`'s real
 * runtime-resolved roots"). engine-core's compiled, MANDATORY sandbox
 * `denyRead` tilde literals (`~/.local/state/crabgic/**`,
 * `~/.cache/crabgic/**`) — read from a REAL compiled
 * canonical profile, not the standalone constants in isolation — must stay
 * consistent with `@crabgic/journal`'s own exported XDG layout constants/
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
} from "@crabgic/engine-core";
import {
  resolveXdgStateHome,
  resolveXdgCacheHome,
  CRABGIC_DIR_NAME,
  type XdgEnv,
} from "@crabgic/journal";

const UNSET_XDG_ENV: XdgEnv = { HOME: "/home/testuser" };

describe("engine-core's compiled mandatory denyRead tilde literals appear in a real compiled profile", () => {
  it("compileEnvelope(READ_ONLY_ENVELOPE)'s sandbox.filesystem.denyRead includes both tilde literals verbatim", () => {
    const profile = compileEnvelope(READ_ONLY_ENVELOPE);
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_STATE_ROOT_DENY_PATH);
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_CACHE_ROOT_DENY_PATH);
  });
});

describe("engine-core's tilde-anchored defaults stay consistent with @crabgic/journal's XDG resolution (unset $XDG_STATE_HOME/$XDG_CACHE_HOME)", () => {
  it("CONTROL_REPO_STATE_ROOT_DENY_PATH, with '~' expanded to HOME, equals journal's own resolveXdgStateHome + CRABGIC_DIR_NAME", () => {
    const expected = `${resolveXdgStateHome(UNSET_XDG_ENV)}/${CRABGIC_DIR_NAME}/**`;
    const actual = CONTROL_REPO_STATE_ROOT_DENY_PATH.replace(/^~/, UNSET_XDG_ENV.HOME);
    expect(actual).toBe(expected);
    // Sanity on the XDG spec's own documented default itself.
    expect(resolveXdgStateHome(UNSET_XDG_ENV)).toBe(`${UNSET_XDG_ENV.HOME}/.local/state`);
  });

  it("CONTROL_REPO_CACHE_ROOT_DENY_PATH, with '~' expanded to HOME, equals journal's own resolveXdgCacheHome + CRABGIC_DIR_NAME", () => {
    const expected = `${resolveXdgCacheHome(UNSET_XDG_ENV)}/${CRABGIC_DIR_NAME}/**`;
    const actual = CONTROL_REPO_CACHE_ROOT_DENY_PATH.replace(/^~/, UNSET_XDG_ENV.HOME);
    expect(actual).toBe(expected);
    expect(resolveXdgCacheHome(UNSET_XDG_ENV)).toBe(`${UNSET_XDG_ENV.HOME}/.cache`);
  });

  /**
   * THE GAP THIS TEST USED TO DOCUMENT IS NOW CLOSED.
   *
   * It previously asserted `.not.toBe(...)` — that engine-core's tilde
   * literal does not track a non-default `$XDG_STATE_HOME` — and called that
   * an acceptable carried-forward seam. It was not acceptable: the engine's
   * own `Write`/`Edit` tools run OUTSIDE the bubblewrap boundary
   * (`docs/evidence/phase-06/sandbox-containment-determination.json`, arm
   * `sandbox-write-tool`, where a real compiled sandbox still allowed writes
   * to all four out-of-path targets), so for those tools the deny RULE is the
   * only thing standing between a worker and the journal. Under a custom
   * `$XDG_STATE_HOME` that rule pointed somewhere the journal was not.
   *
   * The seam itself still holds: engine-core does not import
   * `@crabgic/journal`. The caller — which knows the real environment —
   * resolves the roots and passes them in.
   */
  it("a non-default $XDG_STATE_HOME IS covered once the caller passes its resolved roots", () => {
    const overriddenEnv: XdgEnv = { HOME: "/home/testuser", XDG_STATE_HOME: "/custom/state/root" };
    const realStateRoot = `${resolveXdgStateHome(overriddenEnv)}/${CRABGIC_DIR_NAME}`;
    const realCacheRoot = `${resolveXdgCacheHome(overriddenEnv)}/${CRABGIC_DIR_NAME}`;

    const profile = compileEnvelope(READ_ONLY_ENVELOPE, undefined, {
      stateRoot: realStateRoot,
      cacheRoot: realCacheRoot,
    });

    // The REAL journal location is denied, for read and for write, in the
    // sandbox and in the permission rules the engine's own file tools obey.
    expect(profile.sandbox.filesystem.denyRead).toContain(`${realStateRoot}/**`);
    expect(profile.sandbox.filesystem.denyWrite).toContain(`${realStateRoot}/**`);
    expect(profile.permissions.deny).toContain(`Read(${realStateRoot}/**)`);
    expect(profile.permissions.deny).toContain(`Write(${realStateRoot}/**)`);
    expect(profile.permissions.deny).toContain(`Edit(${realStateRoot}/**)`);
    expect(profile.sandbox.filesystem.denyRead).toContain(`${realCacheRoot}/**`);

    // The tilde defaults are KEPT, not replaced: they are still correct when
    // the env vars are unset, and deny-wins means an extra deny is never a
    // loosening.
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_STATE_ROOT_DENY_PATH);
  });

  it("omitting the resolved roots leaves the previous behaviour exactly as it was", () => {
    const profile = compileEnvelope(READ_ONLY_ENVELOPE);
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_STATE_ROOT_DENY_PATH);
    expect(profile.sandbox.filesystem.denyRead).toContain(CONTROL_REPO_CACHE_ROOT_DENY_PATH);
  });

  it("a resolved root identical to the tilde default is not emitted twice", () => {
    const profile = compileEnvelope(READ_ONLY_ENVELOPE, undefined, {
      stateRoot: `${UNSET_XDG_ENV.HOME}/.local/state/${CRABGIC_DIR_NAME}`,
      cacheRoot: `${UNSET_XDG_ENV.HOME}/.cache/${CRABGIC_DIR_NAME}`,
    });
    const denies = profile.sandbox.filesystem.denyRead.filter(
      (entry) => entry === `${UNSET_XDG_ENV.HOME}/.local/state/${CRABGIC_DIR_NAME}/**`,
    );
    expect(denies).toHaveLength(1);
  });
});
