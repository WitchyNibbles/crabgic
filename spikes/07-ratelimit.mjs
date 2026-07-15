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
// (fixture scan below reads only files already committed under spikes/fixtures/)
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

// --- Probe B: structured rate_limit_event shape — OBSERVED in this phase's own committed fixtures ---
// Validation-round finding: the ordinary spike runs (02/03/04/05) each
// received `rate_limit_event` messages in their SDK streams as a matter of
// course; the sanitized transcripts committed in spikes/fixtures/ therefore
// already contain the structured signal shape. This probe scans those
// committed fixtures (no live API call) and records every distinct
// rate_limit_info payload verbatim.
function collectRateLimitEvents() {
  const found = []; // {file, info}
  const jsonFiles = [
    "03-permissions.transcripts.sanitized.json",
    "04-sandbox.transcripts.sanitized.json",
    "05-structured-output.transcripts.sanitized.json",
  ];
  const walk = (obj, file) => {
    if (Array.isArray(obj)) { obj.forEach((v) => walk(v, file)); return; }
    if (obj && typeof obj === "object") {
      if (obj.type === "rate_limit_event" && obj.rate_limit_info) found.push({ file, info: obj.rate_limit_info });
      for (const v of Object.values(obj)) walk(v, file);
    }
  };
  for (const f of jsonFiles) {
    const p = join(__dirname, "fixtures", f);
    if (existsSync(p)) walk(JSON.parse(readFileSync(p, "utf8")), f);
  }
  const jsonlPath = join(__dirname, "fixtures", "02-hermeticity.transcript.sanitized.jsonl");
  if (existsSync(jsonlPath)) {
    for (const line of readFileSync(jsonlPath, "utf8").trim().split("\n")) {
      try {
        const m = JSON.parse(line);
        if (m.type === "rate_limit_event" && m.rate_limit_info) found.push({ file: "02-hermeticity.transcript.sanitized.jsonl", info: m.rate_limit_info });
      } catch {}
    }
  }
  return found;
}

const rlEvents = collectRateLimitEvents();
const distinctPayloads = [...new Set(rlEvents.map((e) => JSON.stringify(e.info)))];
const statusesSeen = [...new Set(rlEvents.map((e) => e.info.status))];

entries.push(verdict({
  probe: "ratelimit.structured-event-shape",
  expectation: "capture the structured stream-json / SDK-stream rate-limit signal shape verbatim",
  observed:
    `OBSERVED — ${rlEvents.length} \`rate_limit_event\` message(s) found in this phase's own committed fixtures (files: ${[...new Set(rlEvents.map((e) => e.file))].join(", ")}). ` +
    `Shape: {"type":"rate_limit_event","rate_limit_info":{...},"uuid":...,"session_id":...}. Distinct rate_limit_info payloads, verbatim: ${distinctPayloads.join(" | ")}. ` +
    `Statuses observed: ${statusesSeen.join(", ")}. The SDK type declaration (sdk.d.ts SDKRateLimitEvent/SDKRateLimitInfo) types status as 'allowed'|'allowed_warning'|'rejected', ` +
    `rateLimitType as 'five_hour'|'seven_day'|'seven_day_opus'|'seven_day_sonnet'|'seven_day_overage_included'|'overage', with numeric epoch-seconds resetsAt, utilization, overage* fields, and errorCode?: 'credits_required'. ` +
    "Phase 06 must build limitSignal detection from THIS real schema (status transition to 'rejected', rateLimitType, resetsAt), not from a synthesized guess.",
  verdict: rlEvents.length > 0 ? "PASS" : "UNRESOLVED",
  ...(rlEvents.length > 0 ? {} : { note: "MITIGATION: fixtures did not contain rate_limit_event on this pass; capture opportunistically per probe C." }),
}));

// --- Probe C: the exhausted/blocked variant — still unobserved ---
const OBSERVED_SIGNAL = "Agent terminated early due to an API error: You've hit your session limit · resets 2:10pm (Europe/Madrid)";
entries.push(verdict({
  probe: "ratelimit.exhausted-variant-shape",
  expectation: "capture the EXHAUSTED/blocked variant (SDK-typed status:'rejected', and/or the terminal result/error emitted when a request is actually refused) verbatim",
  observed:
    `NOT yet observed as a structured event: every committed rate_limit_event carries status 'allowed' or 'allowed_warning' (see ratelimit.structured-event-shape); the 'rejected' status exists in the SDK type but no live sample was captured. ` +
    `The only exhausted-limit sample from this host (2026-07-15) is the plain error STRING surfaced to a headless agent process: "${OBSERVED_SIGNAL}" — a human-readable sentence naming the limit kind and a localized reset time, ` +
    "which does not reveal how (or whether) a status:'rejected' rate_limit_event and/or a distinct terminal result message accompany the refusal in-stream.",
  verdict: "UNRESOLVED",
  note: "MITIGATION: the next time ANY worker on this host naturally hits a subscription limit while streaming, capture the RAW message sequence verbatim into spikes/fixtures/07-ratelimit.live-capture.sanitized.jsonl and update this verdict; never trigger deliberately on the owner's subscription (see probe A).",
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
