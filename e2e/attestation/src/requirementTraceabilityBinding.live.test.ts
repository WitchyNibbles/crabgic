import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  REQUIREMENT_TRACEABILITY_GATE_TAG,
  resolveReleaseCandidateObjectId,
} from "./evidence.js";
import { readReleaseRequirements, requirementIdForGateTag } from "./releaseRequirements.js";
import { TRACEABILITY_INPUT_PATH, TRACEABILITY_RECORD_ENV } from "./requirementTraceability.js";
import {
  CONTAINERIZED_PROVENANCE_SOURCE,
  buildTraceabilityEvidenceFile,
} from "./traceabilityEvidence.js";
import {
  CONTAINER_ADMIN_SECRET_ENV,
  runContainerizedGrafanaBinding,
} from "./live/grafanaTraceabilityBinding.js";
import {
  SEAM_PINNED_DIAL_ADDRESS,
  SEAM_RESOLVED_ADDRESS,
  SEAM_TLS_TERMINATION_DESCRIPTION,
  startTlsFront,
  type TlsFront,
} from "./live/tlsFrontedContainer.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * roadmap/23 exit criterion: "Every requirement linked to evidence from the
 * exact final Git object ID and remote (Jira/Grafana) revisions (21's
 * traceability report)."
 *
 * THE POINT OF THIS TEST is to produce ONE genuinely-confirmed remote
 * revision, from a containerized real system, and write it to
 * `docs/evidence/phase-23/requirement-traceability.json`. roadmap/23:56
 * forbids `packages/testkit`'s fakes as the basis of 23's own final
 * verdicts and allows "live or containerized" — and this repo's Grafana
 * cassettes are HAND-AUTHORED, not recorded (`fixtures/cassettes.ts:12-14`),
 * so a cassette-derived `RemoteResource` here would be a false green. This
 * boots the repo's own `docker/grafana/12.4/docker-compose.yml` recipe,
 * fronts it with TLS, and drives a real create through the real
 * `executeMutationPlan`.
 *
 * IT BINDS EXACTLY ONE REQUIREMENT — the traceability criterion itself,
 * which is the one this dashboard genuinely evidences. Binding all 16
 * release requirements to one throwaway dashboard would be fabrication, and
 * the release-gate item stays FAIL for the other 15 for the honest reason
 * ("bound to no remote (Jira/Grafana) resource"). That FAIL is the correct
 * outcome, not a defect in this test.
 *
 * Never run by the default attestation gate (`vitest.config.ts` excludes
 * `**{/}*.live.test.ts`) — it needs a live Docker daemon. Run via
 * `npm run attestation:test:live` (`vitest.live.config.ts`).
 */

// MOVED OFF 11.6 (2026-07-26). That recipe was retired from the supported
// matrix when the support-window probe found the version out of vendor
// support since 2026-06-25; binding the release's traceability evidence to a
// container the same release no longer claims to support would have made the
// two statements contradict each other. 12.4 is supported to 2027-05-24 and
// its recipe is smoke-tested. Pinned to the exact tag the compose file pins,
// so this constant and `docker/grafana/12.4/docker-compose.yml` cannot drift.
const COMPOSE_FILE = "docker/grafana/12.4/docker-compose.yml";
const CONTAINER_IMAGE = "grafana/grafana-oss:12.4.3";
const CONTAINER_HTTP_PORT = 3000;
const COMPOSE_PROJECT = `eo-attestation-traceability-${process.pid}`;

/**
 * The compose recipe's own `GF_SECURITY_ADMIN_PASSWORD`. Published in each
 * `docker/grafana/<version>/docker-compose.yml`, container-local, loopback-only and
 * destroyed with the container — but it is still handed to the run through
 * the connection's declared `secretRef` and the production
 * `resolveSecretReference`, rather than hardcoded at the call site, so the
 * credential-resolution path is genuinely exercised.
 */
const COMPOSE_ADMIN_CREDENTIAL = "admin:admin";

let front: TlsFront | undefined;
let composeUp = false;

async function compose(...args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-f", join(REPO_ROOT, COMPOSE_FILE), "-p", COMPOSE_PROJECT, ...args],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

async function waitForHealthy(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${CONTAINER_HTTP_PORT}/api/health`);
      if (response.ok) {
        const body = (await response.json()) as { database?: string };
        if (body.database === "ok") return;
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("Grafana container never reported database:ok");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

function releaseCandidateObjectId(): string {
  const resolved = resolveReleaseCandidateObjectId();
  if (resolved !== FAKE_RELEASE_CANDIDATE_OBJECT_ID) return resolved;
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

// GUARANTEED TEARDOWN — runs even when the body below throws, mirroring
// `e2e/provisioning`'s own crash-safe contract.
afterAll(async () => {
  await front?.close();
  if (composeUp) await compose("down", "-v");
});

describe("@live requirement traceability — containerized Grafana, genuine confirmed revision", () => {
  it("binds a real MutationApplyResult.appliedRevision and writes the release traceability artifact", async () => {
    await compose("up", "-d");
    composeUp = true;
    await waitForHealthy(150_000);

    front = await startTlsFront(CONTAINER_HTTP_PORT);
    process.env[CONTAINER_ADMIN_SECRET_ENV] ??= COMPOSE_ADMIN_CREDENTIAL;

    const objectId = releaseCandidateObjectId();

    // EVERY requirement the gate demands a remote binding of, not just the
    // traceability criterion. `checkRequirementTraceability` scopes that
    // demand to the criteria whose subject is a remote system (see
    // `releaseRequirements.ts`'s `REMOTE_SUBJECT_CRITERIA`); binding only
    // one of them left the others reported as "bound to no remote
    // (Jira/Grafana) resource" with no producer that could ever fix it.
    // Deriving the list here rather than hardcoding it means a change to
    // that scope is picked up by this producer automatically.
    const requirements = readReleaseRequirements(REPO_ROOT);
    const requirementIds = requirements
      .filter((requirement) => requirement.requiresRemoteBinding)
      .map((requirement) => requirement.id);
    expect(requirementIds.length).toBeGreaterThan(0);
    // The traceability criterion itself must be among them — it is the one
    // that names remote revisions outright.
    expect(requirementIds).toContain(
      requirementIdForGateTag(requirements, REQUIREMENT_TRACEABILITY_GATE_TAG),
    );

    const run = await runContainerizedGrafanaBinding({
      baseUrl: front.baseUrl,
      certPath: front.certPath,
      requirementIds,
      releaseCandidateObjectId: objectId,
    });

    console.log(`[traceability-binding] outcome: ${JSON.stringify(run.outcome)}`);
    console.log(
      `[traceability-binding] container: ${CONTAINER_IMAGE} reported ${run.edition} ${run.reportedVersion}`,
    );

    // The pipeline's own verdict, asserted rather than assumed: only a
    // `recorded`/`replayed` outcome carries a read-back-confirmed revision.
    expect(run.outcome.status).toBe("recorded");
    expect(run.bindings).toHaveLength(requirementIds.length);
    for (const binding of run.bindings) {
      expect(binding.resource.revision.length).toBeGreaterThan(0);
      expect(binding.pointer.confirmedRevision).toBe(run.outcome.appliedRevision);
    }
    // Every scoped requirement is actually covered — not the same one twice.
    expect(run.bindings.map((binding) => binding.pointer.requirementId).sort()).toEqual(
      [...requirementIds].sort(),
    );

    const artifact = buildTraceabilityEvidenceFile({
      provenance: {
        source: CONTAINERIZED_PROVENANCE_SOURCE,
        capturedAt: new Date().toISOString(),
        releaseCandidateObjectId: objectId,
        mutationOutcome: run.outcome.status,
        evidenceJournal: run.evidenceJournal,
        container: {
          image: CONTAINER_IMAGE,
          composeFile: COMPOSE_FILE,
          reportedVersion: run.reportedVersion,
          edition: run.edition,
        },
        transportSeams: {
          resolveHostAddresses: SEAM_RESOLVED_ADDRESS,
          sendRequestPinnedAddress: SEAM_PINNED_DIAL_ADDRESS,
          tlsTermination: SEAM_TLS_TERMINATION_DESCRIPTION,
        },
      },
      remoteResources: run.bindings.map((binding) => binding.resource),
      pointers: run.bindings.map((binding) => binding.pointer),
    });

    // WRITE WHERE THE CONSUMER READS. `$EO_REQUIREMENT_TRACEABILITY_RECORD`
    // (Gap 16) points `readRequirementTraceabilityInput` at an artifact
    // produced outside the checkout being scored; honouring it here is what
    // makes producer and consumer one loop. Committing this file instead
    // would advance HEAD past the object ID the artifact names, which is the
    // catch-22 the override exists to break. Unset — an ordinary developer
    // run — still writes the in-repo copy, unchanged.
    const override = process.env[TRACEABILITY_RECORD_ENV];
    const outputPath =
      override === undefined || override.trim() === ""
        ? join(REPO_ROOT, TRACEABILITY_INPUT_PATH)
        : override;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
    console.log(`[traceability-binding] wrote ${outputPath}`);
    console.log(`[traceability-binding] ${run.evidenceJournal}`);

    await run.cleanup();
  }, 240_000);
});
