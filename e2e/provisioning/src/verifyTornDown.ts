import type { ComposeRunner, SurvivingResources } from "./composeRunner.js";

export interface TeardownVerification {
  readonly tornDown: boolean;
  readonly surviving: SurvivingResources;
}

/**
 * roadmap/23-release-hardening.md work item 2's own fail-first criterion:
 * "teardown-verification FAILs if a forced-abort leaves any tenant/container
 * alive." This is the query side of that check — it reports, by the
 * `com.docker.compose.project=<runId>` label alone (never trusting a
 * possibly-stale compose file), whether anything from `runId` still exists.
 * Callers assert `tornDown === true`; a caller wanting a hard failure can
 * throw on a `false` result themselves (kept a plain query here so tests can
 * inspect the `surviving` detail on either outcome).
 */
export async function verifyTornDown(
  runId: string,
  runner: ComposeRunner,
): Promise<TeardownVerification> {
  const surviving = await runner.listSurviving(runId);
  const tornDown =
    surviving.containers.length === 0 &&
    surviving.volumes.length === 0 &&
    surviving.networks.length === 0;
  return { tornDown, surviving };
}
