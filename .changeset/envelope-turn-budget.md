---
"crabgic": minor
---

Make the worker turn budget an authority dimension, because it wasn't one.

Spend was journaled (v1.4.x) but the cap was nobody's: the dispatcher
hardcoded 40 turns per attempt and no policy governed it — an authority the
containment gate never saw, the exact class of unchecked dimension a recent
review found in `remoteResourceAuthorizations`.

Now the chain is closed end to end:

- `AuthorizationEnvelope.maxTurnsPerAttempt` — what a run REQUESTS (turns are
  the authoritative unit, USD informational, per §5.7). Absent defaults to
  the bounded `DEFAULT_MAX_TURNS_PER_ATTEMPT` (40) and hashes identically to
  an explicit 40, so pre-existing intake requests neither break nor
  spuriously invalidate approval tokens; a DIFFERENT budget is a material
  change and a new canonical hash.
- `EnvelopePolicy.maxWorkerTurnsPerAttempt` — what the owner GRANTS.
  Defaults to **0: grants nothing**, so a policy on disk from before this
  axis existed denies it and every dispatch escalates, naming the field to
  set — the ledger's F10 fail-closed shape for a new authority axis, applied
  as designed. `crabgic install` authors 40 on fresh derivations. A flat
  field, because `digestPolicy` hashes plain JSON and the first nested field
  would silently change the journaled authorization identity.
- `isContained` gates request ≤ ceiling like every other dimension —
  all-or-nothing, every escaping dimension named, malformed numbers on
  either side fail closed.
- The dispatcher compiles the ENVELOPE's value into every
  `TaskPacket.resourceLimits.maxTurns`, where the engine enforces it. The
  hardcoded constant is gone.
- `crabgic approve`'s consent render and the doctor's grant line show the
  budget — and the consent render now also shows remote resources,
  dependencies and temporary services, which its own doc comment claimed it
  did and did not.

Also fixed en route: `npm run build:schemas` had been silently broken since
the zod-4 upgrade — `zod-to-json-schema` emits an empty `{}` for every zod-4
schema and nothing in CI runs the script. It now uses zod's native
`z.toJSONSchema` (draft-7, fully inlined) and the 21 committed schema files
are regenerated current.

Owners upgrading: the first dispatch after this release escalates with
`worker turn budget: the envelope requests 40 turns per attempt but the
policy grants up to 0 (set "maxWorkerTurnsPerAttempt" in the standing
policy to grant more)` — add the field to the standing policy file (40
restores the previous behavior). Adversarial review hardened this path
before merge: `crabgic doctor` now FAILS a zero-turn policy instead of
rendering a green check on an installation that refuses every dispatch;
the daemon's containment refusal names the policy file (editing it is the
only remedy that works — `crabgic approve` mints a token the dispatch gate
never reads, a pre-existing dead-end now tracked separately); and the
`install` confirmation renders the turn grant, which is the standing
policy's actual authoring moment and must never show less than it grants.

Known divergence, stated: the published `authorization-envelope.json` JSON
schema describes the PARSED (output) shape, so `maxTurnsPerAttempt` appears
in `required` — a raw pre-upgrade envelope file validates under zod (the
default applies at parse) but not against the published schema.
