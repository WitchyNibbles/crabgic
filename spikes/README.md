# Engine verification spikes (Phase 00)

Throwaway probe scripts that check facts this roadmap needs against a live,
logged-in Claude Code installation, and record one PASS/FAIL/UNRESOLVED
verdict per probe into `docs/engine-baseline.md`. Nothing here is published;
this directory is **not** a workspace member — it has its own standalone
`package.json` (the root `workspaces` glob covers `packages/*` only).

Anything engine-touching elsewhere in this repo cites `docs/engine-baseline.md`,
never memory, per the project's ground rule. This directory is where that
baseline is produced and re-verified.

## Host prerequisites

- Linux or WSL2 (macOS Seatbelt / native Windows are out of scope for this repo).
- `claude` CLI installed and on `PATH`, already logged in interactively at
  least once (populates `~/.claude/.credentials.json`, mode 0600) — every
  script here falls back to that file when no OAuth token is available; see
  the auth decision record in `docs/engine-baseline.md`.
- Node.js 18+ (tested on v24.18.0).
- `bwrap` (bubblewrap) and `socat` on `PATH` for spike 04's sandbox probes
  (Linux/WSL2 sandbox dependencies: `sudo apt-get install bubblewrap socat`).
  Without them, spike 04 still runs its "absence" sub-probes (presence
  check, `failIfUnavailable` abort behavior) but the bwrap-dependent probes
  (egress denial, UDS reachability, `denyRead`, masked secrets) come back
  UNRESOLVED with that install command as the mitigation.
- To exercise the primary (non-fallback) auth path: mint a token via
  `claude setup-token` (interactive) and either export it as
  `CLAUDE_CODE_OAUTH_TOKEN`, or write it to `~/.claude/.eo-oauth-token`
  (mode 0600) — `spikes/01-auth.mjs` reads either source at runtime, in that
  order, and needs no code change to pick it up.

## Install

```sh
cd spikes
npm install   # installs @anthropic-ai/claude-agent-sdk locally to spikes/
```

## Running

Each script is standalone and safe to re-run any number of times; none of
them mutate the real `~/.claude` (all "user tier" / "project tier" rogue
settings and all credential copies are planted only inside `os.tmpdir()`
scratch directories that are removed in a `finally` block, success or
failure):

```sh
node 01-auth.mjs
node 02-hermeticity.mjs
node 03-permissions.mjs
node 04-sandbox.mjs
node 05-structured-output.mjs
node 06-sessions.mjs
node 07-ratelimit.mjs        # makes NO live API call — see script header
node 08-tool-catalog-env.mjs # tool-catalog: allowlisted vs inherited env, SDK vs CLI
```

Scripts 01–07 map one-to-one onto roadmap/00's seven In-scope probes.
Script 08 is a follow-up added during phase 00 (orchestrator-directed): it
captures the engine's tool catalog under a strictly allowlisted env vs. a
fully inherited env, and on the SDK vs. CLI transports, and it pins the
subagent-spawn tool's live literal name (`Task`) plus the fact that
`deny: ["Agent"]` / `deny: ["Task"]` enforce by removing the tool from the
catalog (fail-closed) rather than by call-time denial. It is part of the
re-verification suite: run it alongside 01–07 on every version bump.

or via the package.json scripts (`npm run auth`, `npm run hermeticity`, …).

Every run overwrites its verdict file at `fixtures/0N-*.verdicts.json` and
(where applicable) its sanitized transcript fixture at
`fixtures/0N-*.transcripts.sanitized.json(l)`. Console output prints one
`VERDICT_JSON {...}` line per probe.

## Verdict-block format

Every probe prints (and records into its fixture file) an object of this
exact shape:

```jsonc
{
  "probe": "namespace.probe-id",       // stable id, e.g. "permissions.deny-wins-same-level"
  "expectation": "...",                 // what the doc/roadmap predicts
  "observed": "...",                    // what was actually seen, verbatim where it matters
  "verdict": "PASS" | "FAIL" | "UNRESOLVED",
  "note": "..."                          // present only on UNRESOLVED: explicit mitigation (Hard Rule 1)
}
```

`docs/engine-baseline.md` is the synthesis of every `fixtures/0N-*.verdicts.json`
file plus narrative context; it is the citable document, not this directory.

## Security

- No script hardcodes a token. Real `.credentials.json` bytes are copied
  only into `os.tmpdir()`-based isolated directories for the lifetime of a
  single probe run, at mode 0600, deleted in a `finally` block.
- `spikes/01-auth.mjs` additionally greps its own verdict-file output for
  the first 8 characters of any OAuth token it used before treating the run
  as clean, in addition to the shared token-shaped-substring scan below.
- `lib/verdict.mjs`'s `scanForSecrets()` greps every verdict/fixture file
  this directory writes for `sk-ant-*` token shapes, OAuth
  accessToken/refreshToken JSON blobs, and the real `$HOME` path, before a
  script reports itself clean. A non-empty result exits non-zero.
- Rogue settings/hooks/CLAUDE.md/.mcp.json planted for the hermeticity and
  permission probes live only under `os.tmpdir()` scratch directories, never
  under the real `~/.claude` or this repo's own `.claude/` (there isn't
  one) — see each script's header comment for exactly what is planted where.

## Re-verification procedure (version bump)

Per the "00/06 policy" referenced by phase 23: before adopting a newer
pinned `claude` CLI version,

1. Record the new `claude --version` output.
2. Re-run all seven scripts unmodified against the new version.
3. Every verdict that was previously `PASS` must reproduce as `PASS`. Any
   regression, or any new `FAIL`/`UNRESOLVED`, blocks adopting the new
   version until `docs/engine-baseline.md` is updated to explain the change
   and downstream phases (03, 06, 09, 13) re-check their assumptions against
   the updated verdict.
4. Update the "tested version" and "accepted range" fields at the top of
   `docs/engine-baseline.md`, and append to its "changes that would
   invalidate this baseline" list if the new version changed anything not
   already anticipated there.
5. Re-run the sanitization scan (`scanForSecrets`) on the refreshed fixtures
   before committing them.
