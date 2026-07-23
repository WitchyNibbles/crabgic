# Phase 06 work item 2 — `EngineEvent` normalizer + `limitSignal` detection (worker W2)

Scope: `packages/engine-claude/src/event-normalizer.ts`, `src/limit-signal.ts`, their
`.test.ts` files, and the `[W2-EXPORTS]` anchor line in `src/index.ts`.

Command (repo root only): `npx vitest run --project @eo/engine-claude --coverage.enabled=false`.

## RED — captured verbatim

TDD was applied per-module: the test file was written first, the sibling implementation
file was then moved aside, the suite was run to capture the RED failure below, and the
implementation file was restored unchanged before moving to GREEN.

### `limit-signal.test.ts` (module absent)

```
FAIL  |@eo/engine-claude| src/limit-signal.test.ts [ packages/engine-claude/src/limit-signal.test.ts ]
Error: Cannot find module './limit-signal.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/limit-signal.test.ts
 ❯ src/limit-signal.test.ts:10:1
      8| } from "@eo/testkit";
      9| import type { SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk…
     10| import {
       |   ^
     11|   detectLimitErrorString,
     12|   LimitSignalNormalizationError,

 Test Files  4 failed | 1 skipped (5)
      Tests  5 skipped (5)
```

(The other 3 failed suites in that run — `auth.test.ts`, `gateway-server-config.test.ts`,
`version-gate.test.ts` — are W1's in-flight files, not this work item's; included verbatim
because that's what the command actually printed.)

### `event-normalizer.test.ts` (module absent)

```
FAIL  |@eo/engine-claude| src/event-normalizer.test.ts [ packages/engine-claude/src/event-normalizer.test.ts ]
Error: Cannot find module './event-normalizer.js' imported from /home/eimi/projects/crabgic/packages/engine-claude/src/event-normalizer.test.ts
 ❯ src/event-normalizer.test.ts:4:1
      2| import { describe, expect, it } from "vitest";
      3| import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
      4| import { EventNormalizationError, normalizeSdkMessage, normalizeSdkStr…
       |   ^

 Test Files  1 failed (1)
      Tests  no tests
```

roadmap/06 work item 2's own "first failing test" (feed phase-00's rate-limit fixture
through the parser and assert a typed `limitSignal` event — fails, no parser exists) is
exactly the RED state above: before `event-normalizer.ts` existed, the fixture-driven test
`normalizeSdkMessage — roadmap/06 work item 2's first failing test` could not even load.

## GREEN — final counts

```
src/limit-signal.test.ts        23 passed
src/event-normalizer.test.ts    53 passed
Total                           76 passed
```

`npx tsc -b` (repo root): clean (exit 0) for the whole workspace at time of this work
item's completion.

Coverage (this work item's two modules only, `--coverage.include` scoped, since the
default gate run in the grading command disables coverage):

```
File               | % Stmts | % Branch | % Funcs | % Lines
-------------------|---------|----------|---------|--------
event-normalizer.ts|   100   |  99.21   |   100   |  100
limit-signal.ts    |   100   |  100     |   100   |  100
All files          |   100   |  99.48   |   100   |  100
```

The single uncovered branch (`event-normalizer.ts`, the `typeof candidate === "string"`
guard on `SDKResultMessage.result`/`errors[]` before the error-string fallback scan) is a
defensive check against a shape the SDK's own type declaration guarantees can't occur
(`result: string` / `errors: string[]` are both non-optional) — kept for runtime safety
against malformed wire data, not reachable from any legitimately-typed input.

## `SDKMessage` member mapping (sdk.d.ts 0.3.210, 39-member union)

| Handled → `EngineEvent`                                      | Baseline citation                                |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `system`/`init` → `init`                                     | §2, §4.4, §7                                     |
| `assistant` → `assistant` and/or `toolUse`                   | §2, §5                                           |
| `result` (`SDKResultSuccess` \| `SDKResultError`) → `result` | §3 (`permission_denials`), §5                    |
| `system`/`api_retry` (`SDKAPIRetryMessage`) → `retry`        | §12 (WAIVED live capture — SDK-typed shape only) |
| `rate_limit_event` (`SDKRateLimitEvent`) → `limitSignal`     | §8                                               |

All other 34 members are a documented skip (`normalizeSdkMessage` returns `undefined`,
never throws): `SDKUserMessage`, `SDKUserMessageReplay` (pairing is `normalizeSdkStream`'s
job, not this pure function's), `SDKPartialAssistantMessage` (`stream_event`),
`SDKCompactBoundaryMessage`, `SDKStatusMessage`, `SDKControlRequestProgressMessage`,
`SDKModelRefusalFallbackMessage`, `SDKModelRefusalNoFallbackMessage`,
`SDKLocalCommandOutputMessage`, `SDKHookStartedMessage`, `SDKHookProgressMessage`,
`SDKHookResponseMessage`, `SDKPluginInstallMessage`, `SDKToolProgressMessage`,
`SDKAuthStatusMessage`, `SDKTaskNotificationMessage`, `SDKTaskStartedMessage`,
`SDKTaskUpdatedMessage`, `SDKTaskProgressMessage`, `SDKBackgroundTasksChangedMessage`,
`SDKThinkingTokensMessage`, `SDKSessionStateChangedMessage`, `SDKWorkerShuttingDownMessage`,
`SDKCommandsChangedMessage`, `SDKNotificationMessage`, `SDKFilesPersistedEvent`,
`SDKToolUseSummaryMessage`, `SDKMemoryRecallMessage`, `SDKElicitationCompleteMessage`,
`SDKPermissionDeniedMessage`, `SDKPromptSuggestionMessage`, `SDKMirrorErrorMessage`,
`SDKInformationalMessage`, `SDKConversationResetMessage`. Fixture-verified skips (present in
the committed transcripts, asserted to normalize to `undefined`): `system`/`thinking_tokens`,
`system`/`status`, `stream_event`, and a raw `user` message.

## Design decisions / deviations (all documented in-source doc comments too)

1. **Tool-use/tool-result pairing** is exclusively `normalizeSdkStream`'s job.
   `normalizeSdkMessage` is pure and per-message, so it can only emit an unpaired `toolUse`
   event (`toolResult` absent) the moment a `tool_use` content block is seen. The stream
   wrapper caches that event by `toolUseId`, and — when the paired `user`/`tool_result`
   message later arrives — emits a **second** `toolUse` event for the same `toolUseId`
   carrying `toolResult`. Consumers correlate by `toolUseId` and treat the latest one as
   authoritative. Verified against `02-hermeticity.transcript.sanitized.jsonl`'s real
   `toolu_01CYZ5Gtij91ebmb37LF7Beo` pair.
2. **`normalizeSdkMessage`'s single-event-per-call limit on `assistant` frames**: every
   baseline-committed `assistant` frame carries exactly one content block of interest
   (`thinking`-only, `tool_use`-only, or `text`-only — never combined), so this was never
   exercised by real evidence. Documented policy if it ever is: `toolUse` (first block)
   wins over concatenated text, and only the first `tool_use` block is represented; the
   stream wrapper does not share this limitation (it extracts and yields every block).
3. **Error-string fallback synthesis** (baseline §8's only-ever-observed exhaustion
   sample, verbatim): `normalizeSdkStream` runs `detectLimitErrorString` over assistant
   text and non-success `result.errors[]`/success `result.result` strings, and on a match
   synthesizes a `limitSignal` event with `status: "rejected"`. There is no
   machine-parseable epoch in a free-text "resets 2:10pm (Europe/Madrid)" phrase, so
   `resetsAt` is set to a documented sentinel `0` — callers must treat a sentinel-`resetsAt`
   `rejected` event as this fallback channel, distinct from a real structured
   `rate_limit_event`. Parking policy stays 13's; this module only detects/surfaces.
4. **`rate_limit_event` field validation** (`limit-signal.ts`) treats `resetsAt` as
   required (throws `LimitSignalNormalizationError` if absent), even though the SDK types
   `SDKRateLimitInfo.resetsAt` as optional — because engine-core's `EngineLimitSignalEvent`
   contract requires it as a non-optional `number`, and all 16 baseline-recorded samples
   carry it regardless. Every other optional field is validated by type when present and
   omitted from the normalized event when absent (`exactOptionalPropertyTypes`-safe
   conditional spreads); an out-of-baseline enum value (`status`, `rateLimitType`,
   `errorCode`) is a typed error, not a silent pass-through — per baseline §8's explicit
   "do not synthesize a guessed shape" directive.
5. **`normalizeLimitSignal`'s error wrapping**: `rateLimitEventToLimitSignal` only ever
   throws its own `LimitSignalNormalizationError` (every failure inside it is a deliberate
   typed check, never an incidental exception), so `normalizeSdkMessage`'s `rate_limit_event`
   branch always re-throws as `EventNormalizationError` (with the original preserved via
   `cause`) rather than branching on `instanceof` — one catchable error class for every
   handled-type failure this module can raise.
6. **`api_retry` mapping**: built from `SDKAPIRetryMessage`'s typed shape only. Baseline §12
   records that a genuine live sample was never captured (WAIVED — inducing a transient
   upstream 5xx/overload deterministically was rejected as unsafe against the owner's
   subscription); this is cited explicitly in the in-source doc comment and this evidence
   file, never presented as a confirmed-live fact.
7. **Schema-violation shape** (baseline §5, `05-structured-output.transcripts.sanitized.json`'s
   `schema-violation` run): `subtype: "success"` with `structured_output` absent normalizes
   to a normal `result` event with `structuredOutput: undefined` — NOT a thrown error. Tested
   directly against the committed fixture, alongside the `happy-path` run (`structured_output`
   present → populated).

## Open questions / carry-forwards

- No committed fixture exists for a live `status: "rejected"` `rate_limit_event` sample or a
  live `api_retry` sample (baseline §8/§12, both explicitly UNRESOLVED/WAIVED). Both mappings
  here are built from the SDK's typed shape only, as directed; retest against a real capture
  the first time either is opportunistically observed (baseline's own mitigation note — not
  this work item's to close).
- The error-string fallback's `resetsAt: 0` sentinel is a documented placeholder, not a real
  epoch. If a future engine version's error-string channel starts carrying a
  machine-parseable timestamp, this synthesis path should be revisited (currently out of
  scope for W2 — parking policy itself is 13's).
