import { buildFakeEngineScript, FakeEngineAdapter, type FakeEngineScript } from "@eo/testkit";
import { validateWorkerResult, type SchedulerWorkerResultValidation } from "@eo/scheduler";
import type { AdjudicationCallback, CompiledWorkerProfile } from "@eo/engine-core";
import type { TaskPacket } from "@eo/contracts";

/**
 * Reproducer harness — roadmap/22-learning-system.md work item 2:
 * "Reproducer harness (failing scenario → replayable fake-engine fixture,
 * via `@eo/testkit`)." An `observation`-stage proposal names a recurring
 * failure; this module turns that failure description into a
 * deterministic, replayable `FakeEngineScript` (03/06's own scripted-trace
 * fixture format, `@eo/testkit`) — the SAME fixture the shadow-run
 * comparator (`../shadow/shadow-comparator.ts`) later applies a candidate
 * lesson against, so "still fails without the lesson, passes with it" is
 * checked against literally the same reproduction, never two drifting
 * copies.
 */
export interface ReproducerFixture {
  /** The `observation`-stage `LearningProposal` id this fixture reproduces. */
  readonly observationId: string;
  readonly script: FakeEngineScript;
}

/** Builds a replayable fixture from a failing-scenario description. `failingScript` is merged over `buildFakeEngineScript`'s own neutral defaults (`@eo/testkit`) — supply whatever `toolCalls`/`failure` shape reproduces the observed recurring failure. */
export function buildReproducerFixture(options: {
  readonly observationId: string;
  readonly failingScript?: Partial<FakeEngineScript>;
}): ReproducerFixture {
  return {
    observationId: options.observationId,
    script: buildFakeEngineScript(options.failingScript ?? {}),
  };
}

export interface ReplayReproducerOptions {
  readonly fixture: ReproducerFixture;
  readonly packet: TaskPacket;
  readonly profile: CompiledWorkerProfile;
  readonly adjudicate: AdjudicationCallback;
}

/**
 * Replays a reproducer fixture against the fake engine and validates the
 * terminal result the SAME way `@eo/scheduler`'s executor does
 * (`validateWorkerResult`) — used both to confirm a freshly-built fixture
 * genuinely reproduces the failure (BEFORE it becomes a `candidate`), and
 * later, with a lesson-preamble-modified packet, to prove a candidate
 * lesson turns a `schemaViolation`/failing replay into a `valid`/
 * succeeded one.
 */
export async function replayReproducer(
  options: ReplayReproducerOptions,
): Promise<SchedulerWorkerResultValidation> {
  const adapter = new FakeEngineAdapter(options.fixture.script);
  const handle = adapter.spawn(options.packet, options.profile, options.adjudicate);

  let validation: SchedulerWorkerResultValidation = {
    kind: "schemaViolation",
    reason: "absent",
    diagnostics: ["reproducer replay ended with no terminal result event (crash)"],
  };
  for await (const event of handle.events) {
    if (event.type === "result") {
      validation = validateWorkerResult(event);
    }
  }
  return validation;
}
