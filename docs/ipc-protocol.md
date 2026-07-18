# IPC protocol — supervisor UDS control plane

This document is the wire-protocol reference for `packages/supervisor`'s Unix-domain-socket
(UDS) control plane (`roadmap/05-supervisor-daemon.md`). It is the document 09's typed CLI
client and 16's gateway-forwarding path are both written against. **Additive-only within a
major version** — see "Versioning" below; `packages/supervisor/src/protocol/wire-schema-golden.test.ts`
enforces this mechanically against `packages/supervisor/schemas/wire-protocol.v1.json`.

## Transport

- **Socket**: a Unix domain socket, path resolved under
  `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/supervisor/run/control.sock` —
  a sibling subpath under `@eo/journal`'s pinned state root (interface-ledger Gap 14
  convention), never a second root.
- **Permissions**: the runtime dir (`.../supervisor/run/`) is `0700`; the socket file itself
  is `0600`. Both are hardened by explicit `chmod` after creation — a bare `mkdir`/`bind`
  leaves wider, umask-shaped permissions (verified empirically:
  `docs/evidence/phase-05/wi1-runtime-dir-perms-failing.txt`).
- **Framing**: ndjson — one JSON object per line, `\n`-terminated. No length prefix, no other
  framing.
- **Trust boundary**: `SO_PEERCRED` — the server reads the connecting peer's real kernel-
  verified `{pid, uid, gid}` and admits ONLY a peer whose `uid` equals the server's own
  invoking uid. Every other outcome (foreign uid, an unreadable/crashed/timed-out credential
  bridge) is refused identically, before the connection is served at all — no handshake, no
  request, nothing. This is what lets exactly two logically distinct local processes reach the
  same router: the CLI (09) directly, and the gateway (16), forwarding its own
  `run.status`/`run.cancel` MCP tools over this identical protocol — "one handler set, two
  transports."

## Handshake

The very first line a client sends on a newly-accepted connection MUST be a `handshake`
message. The server replies with exactly one `handshake_ack` line, then either continues
serving `request` lines (if `accepted: true`) or closes the connection (`accepted: false`) —
**a mismatched protocol version is rejected before any request is ever dispatched.**

```json
{"type":"handshake","protocolVersion":1,"clientName":"engineering-orchestrator-cli"}
{"type":"handshake_ack","protocolVersion":1,"accepted":true}
```

A version mismatch:

```json
{"type":"handshake","protocolVersion":2,"clientName":"eo_gateway"}
{"type":"handshake_ack","protocolVersion":1,"accepted":false,"reason":"protocol version mismatch: server=1, client=2"}
```

## Request / response

After a successful handshake, a client may send any number of `request` lines; the server
replies with exactly one `response` line per request, correlated by `id`. Requests may be
pipelined (a client need not wait for one response before sending the next); the server does
not guarantee response ordering matches request-send ordering across concurrently-dispatched
operations (each operation handler runs independently).

```json
{"type":"request","id":"a1b2c3","op":"run.status","params":{"runId":"11111111-1111-4111-8111-111111111111"}}
{"type":"response","id":"a1b2c3","ok":true,"result":{"run":{"runId":"11111111-1111-4111-8111-111111111111","changeSetId":"...","runState":"running","updatedAt":"2026-07-18T00:00:00.000Z"}}}
```

An error response:

```json
{
  "type": "response",
  "id": "a1b2c3",
  "ok": false,
  "error": { "code": "DISPATCH_ERROR", "message": "..." }
}
```

An unrecognized `op` still produces a well-formed `response` with `ok:false` — the connection
itself is never torn down over one bad request.

## Server-push events

The server may send unsolicited `event` lines at any time after a successful handshake —
never correlated to any request `id`. (v1 defines the envelope shape; the concrete `event`
names streamed over this channel, e.g. per-worker log lines from the ring buffer, roadmap/05
work item 5, are an additive, non-breaking extension point within this major version.)

```json
{ "type": "event", "event": "worker.log", "payload": { "workerId": "...", "line": "..." } }
```

## Operation vocabulary

`run.*` is **UDS-only** — it is never registered as an MCP tool by `packages/supervisor`
itself (interface-ledger Gap 1). 16's gateway forwards its own MCP-visible
`run.status`/`run.cancel` tools over this identical UDS protocol; it never re-implements the
handler.

| Operation                     | Params                   | Result                    | Notes                                                                    |
| ----------------------------- | ------------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `run.status`                  | `{ runId }`              | `{ run? }`                | `run` is absent for an unknown/not-yet-started runId — never a throw.    |
| `run.cancel`                  | `{ runId, reason? }`     | `{ accepted, runState? }` | `accepted:false` for an unknown run or a non-cancellable terminal state. |
| `registry.changeSets.get`     | `{ changeSetId }`        | `{ changeSet? }`          | Populated externally by 11; this package provides the read path only.    |
| `registry.changeSets.list`    | `{}`                     | `{ changeSets }`          |                                                                          |
| `registry.workUnits.list`     | `{ changeSetId? }`       | `{ workUnits }`           |                                                                          |
| `registry.workUnits.get`      | `{ workUnitId }`         | `{ workUnit? }`           |                                                                          |
| `registry.workers.list`       | `{ workUnitId? }`        | `{ workers }`             | Each `WorkerRecord` carries the engine `session_id`.                     |
| `registry.artifactIndex.list` | `{ changeSetId? }`       | `{ artifacts }`           |                                                                          |
| `worker.terminate`            | `{ workerId, graceMs? }` | `{ accepted, status? }`   | Internal administration — drives the SIGTERM → grace → SIGKILL ladder.   |
| `worker.reapOrphans`          | `{}`                     | `{ reapedWorkerIds }`     | Internal administration — the startup orphan-reaping sweep.              |

There is **no `change_set.*`-named operation anywhere** in this vocabulary — enforced by a
repo-wide grep-based conformance test
(`packages/supervisor/src/router/no-change-set-operation.test.ts`). ChangeSet-state queries
are answered exclusively via `registry.changeSets.get`/`registry.changeSets.list`, which 11's
`project.inspect` reads over this same UDS surface.

## Versioning

`PROTOCOL_VERSION` (`packages/supervisor/src/protocol/wire-schema.ts`) is this protocol's own
major version, currently `1`. Within a major version, changes to this protocol are
**additive-only**: new operation names, new optional result fields, new `event` names. A
breaking change (removing/renaming a field, changing a field's required-ness or type,
changing the handshake shape) requires bumping `PROTOCOL_VERSION`.

`packages/supervisor/src/protocol/wire-schema-golden.test.ts` enforces this mechanically: it
diffs a live, introspected descriptor of every wire-message schema's field set against the
byte-committed golden file `packages/supervisor/schemas/wire-protocol.v1.json`. Any
undocumented drift — a field silently added, removed, or renamed without a deliberate,
reviewed edit to the golden file (and, for a breaking change, a matching `PROTOCOL_VERSION`
bump) — fails that test.

## Security notes

- A foreign-uid peer is refused before any request is served (`SO_PEERCRED` check, above).
- A crashed, throwing, or timed-out adjudication bridge (the `AdjudicationCallback` this
  package's own bus wraps — separate from the transport layer, but sharing the same
  fail-closed posture) always resolves to `deny`, never `allow`.
- The idle-resource-budget probe (`packages/supervisor/src/idle-budget/`) reads only
  `process.memoryUsage()`/`process.resourceUsage()` — no environment variables, no socket
  content, no secret material of any kind ever crosses into a heartbeat sample.
