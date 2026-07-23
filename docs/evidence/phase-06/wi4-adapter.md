# Phase 06 work items 1/5/6 — real `ClaudeEngineAdapter` (worker W4)

Scope: `packages/engine-claude/src/adapter.ts`, `src/session.ts`, their test files
(`adapter.test.ts`, `session.test.ts`, `crash-recovery.test.ts`, `xdg-consistency.test.ts`),
and the `[W4-EXPORTS]` anchor line in `src/index.ts`. Composes Wave A's modules
(`options-assembler.ts`, `auth.ts`, `version-gate.ts`, `event-normalizer.ts`,
`adjudication-policy.ts`'s bridge shape, `hooks.ts`, `result-validation.ts`'s consumer
contract) — none of those sibling files were modified.

Command (repo root only): `npx vitest run --project @eo/engine-claude --coverage.enabled=false`.

## RED — captured verbatim

TDD was applied across both modules together: all four test files were written first
against the real `adapter.ts`/`session.ts`, then both implementation files were replaced
with deliberately naive/wrong stubs (each documented `NAIVE STUB (deliberate, temporary)`
in its own top-of-file comment — `ClaudeEngineAdapter` methods that never journal, never
call `sdkQuery`, never validate, and always return an empty/constant result; `session.ts`
helpers that ignore every input and return a fixed constant), the full package suite was
run to capture the RED below, and the real implementations were restored before GREEN.

```
 ❯ |@eo/engine-claude| src/session.test.ts (7 tests | 6 failed) 22ms
     × generates a fresh UUID sessionId when none is supplied 6ms
     × honors an explicit valid sessionId 2ms
     × throws InvalidSessionIdError for a malformed sessionId 1ms
     × builds <configDir>/projects/<munged-cwd>/<sessionId>.jsonl 1ms
     × munges a deeper absolute path the same way 1ms
     × never substitutes a different sessionId/cwd/configDir than the ones sessionRef itself names 6ms
 ❯ |@eo/engine-claude| src/adapter.test.ts (25 tests | 22 failed) 59ms
     × spawn() throws EngineVersionRejectedError synchronously, before any sdkQuery call or journal append 7ms
     × resume() also refuses synchronously outside the accepted range 2ms
     × journals session_assignment, and only THEN calls sdkQuery — recorded call order 5ms
     × adjudicate deny -> SDK sees a deny PermissionResult 2ms
     × adjudicate THROWS -> SDK sees a deny PermissionResult (fail-closed) 1ms
     × adjudicate allow -> SDK sees allow with updatedInput passed through 1ms
     × returns exactly the 5 Gap-7 fields 3ms
     × aborts the controller and rejects the next pull with AdjudicationAuditViolationError 2ms
     × writes one evidence_pointer entry pointing at the transcript path 1ms
     × a scripted result with no structured_output normalizes into an EngineResultEvent that validateWorkerResult flags as a schemaViolation 1ms
     × throws TaskPacketValidationError for a structurally invalid packet, before any sdkQuery call 1ms
     × resolves the installed SDK's paired engine version from its own package.json when no resolver override is supplied 2ms
     × runId is stamped on the session_assignment journal entry and the SessionEnd evidence entry 2ms
     × rolePreamble/model/gatewayServerOverride/pathToClaudeCodeExecutable are all applied to the assembled Options 1ms
     × interrupt: true on the AdjudicationDecision surfaces on the SDK PermissionResult 1ms
     × does not throw and still produces a valid, forkSession-shaped Options object 1ms
     × throws EngineVersionResolutionError for a malformed (non <major>.<minor>.<patch>) version string 1ms
     × throws EngineVersionResolutionError for a well-formed version with no known SDK-to-engine mapping 1ms
     × maps a well-formed 0.3.x SDK version to the paired 2.1.x engine version 1ms
     × returns the immediate package.json when it exists at startDir itself 4ms
     × walks upward when package.json is not at startDir itself 4ms
     × throws EngineVersionResolutionError when no package.json is found within the bounded walk 7ms
 ❯ |@eo/engine-claude| src/crash-recovery.test.ts (4 tests | 3 failed) 34ms
     × collects only the pre-crash events, with no thrown error and no result event 6ms
     × Options.resume === sessionId, cwd/env.CLAUDE_CONFIG_DIR match the crashed session's own sessionRef 3ms
     × Options carry {resume: originalId, forkSession: true, sessionId: <new uuid>} and the original sessionRef is untouched 1ms

 Test Files  3 failed | 13 passed (16)
      Tests  31 failed | 232 passed (263)
```

Two representative assertion-level failures (never "module does not exist" — every module
still existed and compiled, just behaved wrong):

```
 FAIL  |@eo/engine-claude| src/adapter.test.ts > ClaudeEngineAdapter — capabilities() > returns exactly the 5 Gap-7 fields
AssertionError: expected { supportsJsonSchema: false, …(4) } to deeply equal { supportsJsonSchema: true, …(4) }

- Expected
+ Received

  {
-   "engineVersion": "2.1.210",
-   "permissionModel": "dontAsk",
-   "sandboxModel": "bubblewrap",
-   "supportsJsonSchema": true,
-   "supportsSessionResume": true,
+   "engineVersion": "0.0.0",
+   "permissionModel": "naive-stub",
+   "sandboxModel": "naive-stub",
+   "supportsJsonSchema": false,
+   "supportsSessionResume": false,
  }

 FAIL  |@eo/engine-claude| src/session.test.ts > PROPERTY: resume(sessionRef, adjudicate) reconnects the exact (sessionId, worktree, configDir) triple > never substitutes a different sessionId/cwd/configDir than the ones sessionRef itself names
Error: Property failed after 1 tests
Caused by: AssertionError: expected undefined to be '00000000-0000-1000-8000-000000000000'
```

**Honest accounting of the 9 new-file tests that did NOT fail under this naive substitution**
(40 new tests total; 31 genuine RED failures above; `xdg-consistency.test.ts`'s 4 tests are
intentionally excluded from this count — see its own paragraph below):

- 3 `cancel()` tests (`adapter.test.ts`): the naive stub's `events` generator is
  _already_ immediately-`done` (yields nothing), so "never throws for an unknown handle",
  "no forced return needed when the stream already ended", and "forces `.return()` when not
  ended by the deadline" all happen to observe the same vacuous shape the naive stub already
  produces. These are still genuine, meaningful regression tests against the REAL
  implementation's actual branching (`timedOutWaitingFor`'s two outcomes) — confirmed by the
  coverage run below, which shows both branches of `cancel()` exercised — they simply don't
  discriminate against _this specific_ naive stub.
- 1 `session.test.ts` example (`"projectDirectory always equals worktreePath"`): the naive
  stub still returns `projectDirectory === worktreePath` (both hardcoded to the same
  `"/naive-stub"` constant), so the equality holds even though both are wrong.
- 1 `crash-recovery.test.ts` supervisor-integration test: 05's own `spawnManagedWorker`
  unconditionally journals its own `session_assignment` entry and independently detects a
  crash from _any_ stream that ends before a `result` event — which the naive stub's
  always-empty generator also satisfies. The test still exercises the real adapter _type_
  end-to-end; the _behavioral_ proof that resume/fork wiring is correct is carried by the
  other three tests in that file, which failed genuinely.

`xdg-consistency.test.ts` (4 tests, 0 failures under either the naive stub or the real
implementation) validates a cross-phase invariant between already-shipped, already-tested
modules from OTHER workers (`@eo/engine-core`'s `xdg-default-paths.ts`, `@eo/journal`'s
`xdg-layout.ts`) — it exercises no code of this work item's own, so it was born green; no
artificial RED was fabricated for it.

## GREEN — final counts

```
src/adapter.test.ts           25 passed
src/session.test.ts            7 passed
src/crash-recovery.test.ts     4 passed
src/xdg-consistency.test.ts    4 passed
Total (this work item)        40 passed
```

Full package run (all 16 files, every worker's modules together): **263 passed, 0 failed**
(223 pre-existing from Waves A/B + 40 here). `npx tsc -b packages/engine-claude`: clean
(exit 0). `npx tsc -b` (whole repo): clean. `npx eslint` and `npx prettier --check` (scoped
to this work item's 7 files): clean after one `prettier --write` pass (accepted reformatting,
no logic changes) and one `no-this-alias` fix (destructured `{ config, sdkQueryFn }` off
`this` instead of aliasing `this` itself in `buildHandle`).

Property-test run count: **1000 fast-check iterations**, 1 property
(`session.test.ts`'s `SessionRef`/worktree round-trip through the real adapter's `resume()`)
— every run reported zero disagreements: the probed `Options.resume`/`cwd`/
`env.CLAUDE_CONFIG_DIR` always matched the generated `(sessionId, worktreePath, configDir)`
triple exactly, never the adapter's own decoy construction-time config.

Coverage (this work item's two modules only, `--coverage.include` scoped, since the default
gate run in the grading command disables coverage):

```
File          | % Stmts | % Branch | % Funcs | % Lines
--------------|---------|----------|---------|--------
adapter.ts    |  98.42  |  93.87   |  96.29  |  98.4
session.ts    |  100    |  100     |  100    |  100
```

Both comfortably above the 80% line+branch ground rule. Remaining uncovered lines in
`adapter.ts` (191, 214 in the final file) are: (1) `findNearestPackageJson`'s
`parent === dir` filesystem-root-reached break — would require walking a real directory
tree all the way up to `/`, not safely triggerable without mocking `node:path`'s `dirname`;
(2) `defaultEngineVersionResolver`'s "package.json has no string `version` field" throw —
would require the REAL installed SDK's own `package.json` to be malformed, not producible
without mocking `node:fs`'s `readFileSync`. Both are documented, understood defensive gaps,
not defects — every OTHER branch in both functions (malformed version triple, unknown
SDK-to-engine prefix, package.json found immediately vs. after walking up one level, walk
exhausted after 5 iterations) is directly unit-tested via `mapSdkVersionToEngineVersion`/
`findNearestPackageJson`, exported from `adapter.ts` for this purpose only (NOT re-exported
through the public `[W4-EXPORTS]` barrel line).

## Exact `Options` fields observed by the scripted-probe tests

- **spawn (assign mode):** `{ sessionId: <fresh uuid>, cwd: <worktreePath>, env: {
PATH, HOME, TMPDIR, TMP, CLAUDE_CONFIG_DIR: <configDir> }, settingSources: [],
permissionMode: "dontAsk", allowedTools: [...], disallowedTools: [...],
strictMcpConfig: true, mcpServers: { eo_gateway: {...} }, systemPrompt: { type: "preset",
preset: "claude_code", append?: <rolePreamble> }, model: <resolved>, maxTurns: <from
packet>, outputFormat: { type: "json_schema", schema: <packet.resultSchema> },
includePartialMessages: true, canUseTool: <bridge>, hooks: { PostToolUse: [{ hooks:
[auditHook] }], SessionEnd: [{ hooks: [evidenceHook] }] }, abortController }` — no
  `resume`/`forkSession` fields present at all.
- **resume:** identical shape, EXCEPT `resume: <sessionRef.sessionId>` replaces `sessionId`
  (no `sessionId` field is set on plain resume — confirmed directly:
  `crash-recovery.test.ts`'s resume assertion checks `resumeCallOptions?.sessionId` is
  `undefined`); `cwd`/`env.CLAUDE_CONFIG_DIR` are read from the passed-in `sessionRef`'s own
  `worktreePath`/`configDir`, never from the adapter's own construction-time config (proven
  by the 1000-run property test using a deliberately different decoy adapter config).
- **fork:** `{ ...assign-mode fields with a FRESH sessionId, resume: <original
sessionRef.sessionId>, forkSession: true }` — this exact three-field combination
  (`sessionId` + `resume` + `forkSession: true`) is sanctioned by `sdk.d.ts`'s own doc
  comment on `Options.sessionId` ("Cannot be used with `continue` or `resume` unless
  `forkSession` is also set") but has **no representable variant** in `options-assembler
.ts`'s frozen `WorkerSessionSpec` (its `"resume"` branch never sets `sessionId`, only
  `"assign"` does, and the two are mutually exclusive by that module's own design). This
  adapter builds it by assembling with `session: { mode: "assign", sessionId: <new uuid>
}` (giving the correct `sessionId` field) and then spreading `{ resume: <originalId>,
forkSession: true }` on TOP of the assembled `Options` inside `adapter.ts` itself
  (`optionsOverride`, `buildHandle`'s own parameter) — `options-assembler.ts` was not
  modified to add a new variant.

## Duplicate `session_assignment` note (as documented in-source)

README design decision 2 and `adapter.ts`'s own top-of-file/`buildHandle` doc comments: this
adapter journals `session_assignment` **inside its own lazy `events` generator**, on first
pull, BEFORE calling `sdkQuery` (proven by `adapter.test.ts`'s order-proof test: the
recorded call order is always exactly `["journal:session_assignment", "sdkQuery"]`).
05's `worker-lifecycle-manager.ts`'s `spawnManagedWorker` (unmodified) ALSO appends its own
`session_assignment` entry, unconditionally, immediately after `spawn()` returns and before
it starts pumping `handle.events` — by the time that second append happens, THIS adapter's
own append is already durably fsync'd (05 only proceeds to append after its own code path
reaches that point, which is always after at least the intent to consume events has been
established). 05's append is therefore a redundant-but-harmless duplicate entry with the
same `sessionId` payload, by design — 05's code is unchanged (roadmap/06 §Out of scope), and
`crash-recovery.test.ts`'s supervisor-integration test confirms both this adapter's real code
and 05's real, unmodified code coexist without conflict.

## Design decisions / deviations (documented in-source too)

1. **`resume`/`fork` without a `TaskPacket`/`CompiledWorkerProfile` parameter.** 03's frozen
   `EngineAdapter.resume(sessionRef, adjudicate)` (and this package's own `fork` extension)
   carry no packet/profile, yet `assembleWorkerOptions` requires `maxTurns`/`resultSchema`/
   `profile` to build real `Options` — adaptation §5.3's own illustrative sample builds
   spawn and resume through the identical combined `query()` call, confirming these fields
   matter on resume too. This adapter caches `{packet, profile}` per `sessionId` at `spawn()`
   time (`this.spawnContexts`, a `Map`), consulted (and carried forward to the new id) by
   `resume()`/`fork()`. Full-fidelity resume/fork is guaranteed whenever the SAME
   `ClaudeEngineAdapter` instance that originally spawned a session is still the one asked to
   resume it — exactly 05's own crash-detection → `onCrash` call site, since the supervisor
   daemon process (and this adapter instance) survives an engine subprocess crash. For a
   `sessionId` this instance never itself spawned (a genuinely cross-process resume — 13's
   own "restart-safe re-dispatch" scenario, which that phase's own text names, not this
   phase's to solve durably), this adapter falls back to `FALLBACK_SPAWN_CONTEXT`: a
   minimal, intentionally LOW-privilege profile (`compileEnvelope(READ_ONLY_ENVELOPE)` —
   already footgun-clean and exported by `@eo/engine-core`'s own goldens) plus a documented
   conservative `maxTurns`/`resultSchema` default, rather than either throwing or guessing a
   permissive shape. **Flagged as a carry-forward open question** for 13/05's cross-process
   durable-cache reconciliation — this in-process cache does not survive a supervisor daemon
   restart itself.
2. **Default `engineVersionResolver` — a real, reproduced correction to this worker's own
   binding brief.** The brief specified `require.resolve("@anthropic-ai/claude-agent-sdk
/package.json")`. Reproduced directly (not assumed): this throws
   `ERR_PACKAGE_PATH_NOT_EXPORTED` against the actually-installed 0.3.210 package, because
   its own `package.json` `exports` map lists only `".", "./extract", "./browser",
"./bridge", "./sdk-tools", "./sdk-tools.js"` — no `"./package.json"` subpath. Fixed by
   resolving the package's own main entry (`require.resolve("@anthropic-ai/claude-agent-sdk")`,
   a subpath `exports` always allows) and walking upward (bounded at 5 iterations) from its
   directory for the nearest `package.json` — for the installed package this resolves on the
   very first iteration, since `"."` maps directly to `sdk.mjs` at the package root.
3. **Fork's `{sessionId, resume, forkSession}` combination is NOT representable by
   `options-assembler.ts`'s frozen `WorkerSessionSpec`** (see "Exact Options fields" above) —
   handled via an adapter-level `optionsOverride` spread on top of the assembled `Options`,
   not a change to that sibling module.
4. **Prompt assembly from `TaskPacket` fields.** `TaskPacketSchema` (02's real, current
   schema) has no single `prompt` field the way adaptation §5.3's illustrative
   `packet.prompt` sample assumes (that field does not exist on the frozen contract). This
   adapter's own `buildPromptFromTaskPacket` deterministically serializes
   `objective`/`nonGoals`/`constraints`/`relevantInterfaces`/`ownedPaths` into the `prompt`
   string `query()` receives — a genuinely new, minimal-sufficient choice of this phase's
   own scope, not a baseline-cited fact. `resume`/`fork` use fixed short follow-up prompts
   (`"Continue the previous session."` / `"...in this isolated fork."`) since the SDK's own
   session continuation already carries prior context.
5. **`InvalidSessionIdError`/UUID validation reuses `@eo/contracts`' `IdSchema`** rather than
   a hand-rolled regex, per this repo's "reuse, never redefine" convention, and to stay
   aligned with supervisor's `WorkerRecordSchema` (`sessionId: IdSchema`).

## Pre-existing, out-of-scope issue observed (NOT fixed — outside W4's ownership)

A full-repo `npx vitest run` (broader than the required scoped command) surfaces one
pre-existing failure unrelated to any file this worker touched:
`packages/contracts/src/gateway/server-name.test.ts`'s sole-definition-site scanner does not
allowlist `packages/engine-claude/src/gateway-name-reference.test.ts` (a Wave-A/W1 file,
already present before this session started, which legitimately quotes the `"eo_gateway"`
literal 4 times for its own local scanner). Confirmed via `grep` that none of this work
item's own files reference that literal at all. Flagged for whoever owns
`packages/contracts`' scanner or W1's file — outside this worker's `src/adapter.ts`/
`src/session.ts`/test-file/anchor-line ownership.

## SDK facts relied on (`sdk.d.ts` 0.3.210)

- `Options.sessionId?: string` — "Must be a valid UUID. Cannot be used with `continue` or
  `resume` unless `forkSession` is also set (to specify a custom ID for the forked
  session)." — the exact combination `fork()` builds.
- `Options.resume?: string` — "Session ID to resume. Loads the conversation history from
  the specified session."
- `CanUseTool = (toolName, input, { signal, toolUseID, requestId, ... }) => Promise
<PermissionResult | null>`; `PermissionResult` is `{behavior:'allow', updatedInput?,
...} | {behavior:'deny', message, interrupt?, ...}` — near-identical to 03's own
  `AdjudicationDecision` shape, confirming README decision 12's "near-identical shapes"
  claim directly against the type declarations.
- `query(_params: {prompt, options?}): Query` — `Query extends AsyncGenerator<SDKMessage,
void>` with additional control methods (`interrupt`, `setPermissionMode`, etc.);
  structurally assignable to this package's own `SdkQueryFunction`/`SdkMessageStream`
  seam types without a cast.
- The installed `@anthropic-ai/claude-agent-sdk@0.3.210` package's own `package.json`
  `exports` map (verified directly, see deviation 2 above) — the concrete fact behind the
  `require.resolve(".../package.json")` correction.
