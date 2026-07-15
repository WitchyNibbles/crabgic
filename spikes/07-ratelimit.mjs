#!/usr/bin/env node
// spikes/07-ratelimit.mjs
//
// Probe (roadmap/00-engine-spikes.md work item 8; adaptation §5.7, §10 #9):
// drive a subscription rate/usage-limit signal, or document why it cannot
// be triggered safely and record a simulation strategy instead — the
// roadmap's own sanctioned alternative when triggering is unsafe.
//
// HOST REALITY (2026-07-15): the owner already hit a session/usage limit on
// this SAME subscription earlier today. All spikes 01-06 in this phase run
// under that shared subscription. Deliberately exhausting it further to
// observe the live signal would:
//   (a) risk blocking the owner's own concurrent work for the rest of the
//       reset window:  Europe/Madrid resets are hours away;
//   (b) risk blocking every OTHER phase-00 worker/spike sharing this same
//       logged-in account;
//   (c) not even guarantee capturing the STRUCTURED stream-json event shape
//       (vs. only the error-string channel already observed once today).
// This script therefore does NOT make any live API call. It records:
//   1. why deliberate triggering is unsafe today (above),
//   2. a simulation strategy for phase 03 (fake engine) / phase 06 (adapter)
//      to exercise the parking/resume logic without touching the real API,
//   3. the one real signal sample already observed on this host today,
//      exactly as surfaced to a headless agent process, verbatim.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict, writeVerdicts, scanForSecrets } from "./lib/verdict.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entries = [];

// --- Probe A: why deliberate triggering is unsafe today + simulation strategy ---
entries.push(verdict({
  probe: "ratelimit.trigger-safety-and-simulation-strategy",
  expectation: "either safely trigger a real subscription rate/usage-limit signal, or document why not and record a simulation strategy (roadmap-sanctioned alternative)",
  observed:
    "NOT triggered deliberately. The owner's Claude subscription already hit a session/usage limit earlier today (2026-07-15), before this phase began; " +
    "every spike in this phase (01-06) authenticates as the SAME account. Deliberately exhausting it further to observe the live signal risks " +
    "blocking the owner's own concurrent work and any other phase-00 worker sharing this login for the remainder of the reset window, for a payoff " +
    "that is not even guaranteed to include the STRUCTURED stream-json event shape (only the error-string channel has been observed so far, see probe B). " +
    "SIMULATION STRATEGY for downstream phases: " +
    "(1) phase 03's fake engine should synthesize both a stream-json system/error-shaped message AND a plain result-string error carrying the observed " +
    "phrase shape (`\"...API error: You've hit your session limit · resets <time> (<tz>)\"`) as two DISTINCT fixtures, since the real structured shape " +
    "is unconfirmed (see probe B) — the fake engine must not assume one is a subset of the other; " +
    "(2) exercise the scheduler's parked:rate_limit state machine (phase 13) against both synthesized fixtures independently; " +
    "(3) opportunistically capture a REAL fixture the next time any worker naturally hits a limit during ordinary (non-deliberate) use, on any phase, " +
    "and fold it into spikes/fixtures/ retroactively — this is the only safe path to the structured event shape; " +
    "(4) doctor's (phase 09) seeded-fault matrix should include a rate-limit fault path fed by the SAME synthesized fixtures, not a live trigger.",
  verdict: "UNRESOLVED",
  note: "MITIGATION: re-run this probe's live-trigger path only outside owner working hours, on a dedicated/metered test account (not the owner's daily subscription), or opportunistically once a real limit is naturally hit during unrelated work.",
}));

// --- Probe B: the one real signal sample already observed on this host today ---
const OBSERVED_SIGNAL = "Agent terminated early due to an API error: You've hit your session limit · resets 2:10pm (Europe/Madrid)";
entries.push(verdict({
  probe: "ratelimit.observed-signal-sample",
  expectation: "capture the exact error/event shape a subscription rate/usage-limit surfaces as, verbatim",
  observed:
    `Observed today (2026-07-15) on this host, surfaced as a plain error STRING to a headless agent process (channel: process/API error text, NOT a parsed stream-json event): "${OBSERVED_SIGNAL}". ` +
    "This confirms the error-string channel's shape (a human-readable sentence naming the limit kind — 'session limit' — and a localized reset time/timezone) " +
    "but does NOT confirm the structured stream-json event shape (e.g. any dedicated `type`/`subtype` discriminator, machine-parseable reset-timestamp field, " +
    "or limit-kind enum) — that remains UNRESOLVED per adaptation §10 item 10 (exact stream-json event taxonomy unconfirmed) until a real limit is captured " +
    "live through the SDK/CLI's own stream-json output rather than observed only as surfaced prose.",
  verdict: "UNRESOLVED",
  note: "MITIGATION: the next time ANY worker on this host naturally hits a subscription limit while running with --output-format stream-json (or the SDK's message stream), capture the RAW message sequence verbatim into spikes/fixtures/07-ratelimit.live-capture.sanitized.jsonl and update this verdict to PASS (signal shape confirmed) or FAIL (shape differs from what phase 06/13 assumed).",
}));

const outPath = join(__dirname, "fixtures", "07-ratelimit.verdicts.json");
writeVerdicts(outPath, entries);

const hits = scanForSecrets(readFileSync(outPath, "utf8"));
if (hits.length) {
  console.error("SANITIZATION FAILURE:", hits);
  process.exitCode = 1;
} else {
  console.log(`\n${entries.length} verdict(s) recorded to ${outPath}; sanitization scan clean. No live API call was made by this script.`);
}
