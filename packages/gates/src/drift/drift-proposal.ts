import { redactCredentialShapedText, redactSecretBearingObject } from "@eo/connectors-grafana";

/**
 * Drift CI — roadmap/21-connector-evidence-integration.md work item 5: "a
 * scheduled job replays 18/20 cassettes against live/sandbox endpoints;
 * diff → `DriftProposal` artifact (connector, pinned vs observed version,
 * redacted diff reusing 16's redaction discipline, recommended fixture
 * update) for HUMAN review — NEVER auto-changes a pin/routing." This
 * module is the pure comparison/redaction logic; `./run-drift-ci.ts` wires
 * it into an injectable-I/O job runnable from CI.
 *
 * Redaction reuse: `redactSecretBearingObject` is `@eo/connectors-grafana`'s
 * own shared secret-redaction primitive (20's already-tested discipline,
 * itself modeled on 16's). Reused directly here rather than re-implemented,
 * per roadmap/21's explicit "redacted diff reusing 16's provider-body
 * redaction discipline."
 */
export const SUPPORTED_DRIFT_CONNECTORS = ["jira", "grafana"] as const;
export type DriftConnector = (typeof SUPPORTED_DRIFT_CONNECTORS)[number];

/** One pinned-vs-observed comparison point for a connector's cassette/version fixture. */
export interface DriftFixtureSnapshot {
  readonly connector: DriftConnector;
  readonly pinnedVersion: string;
  readonly observedVersion: string;
  /** The pinned cassette/fixture's own field/capability shape (e.g. response field names, supported capability list). */
  readonly pinnedShape: Readonly<Record<string, unknown>>;
  /** The shape actually observed replaying against live/sandbox (or, here, a fixture standing in for it — see docs/evidence/phase-21). */
  readonly observedShape: Readonly<Record<string, unknown>>;
}

export interface DriftProposal {
  readonly connector: DriftConnector;
  readonly pinnedVersion: string;
  readonly observedVersion: string;
  readonly redactedDiff: string;
  readonly recommendedFixtureUpdate: string;
  readonly detectedAt: string;
}

export interface DriftComparison {
  readonly drifted: boolean;
  readonly proposal?: DriftProposal;
}

function sortedKeys(shape: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(shape).sort();
}

/**
 * Compares a pinned fixture against an observed one. Drift is any of:
 * pinned version string != observed version string, or the observed
 * shape's key set differs from the pinned shape's (a renamed field or a
 * withdrawn/added capability — roadmap/21's own conformance-test example).
 * Never mutates either input; never writes anything — purely a comparison.
 */
export function compareDriftFixture(
  snapshot: DriftFixtureSnapshot,
  now: () => Date = () => new Date(),
): DriftComparison {
  const pinnedKeys = sortedKeys(snapshot.pinnedShape);
  const observedKeys = sortedKeys(snapshot.observedShape);
  const versionDrift = snapshot.pinnedVersion !== snapshot.observedVersion;
  const shapeDrift = JSON.stringify(pinnedKeys) !== JSON.stringify(observedKeys);

  if (!versionDrift && !shapeDrift) {
    return { drifted: false };
  }

  const added = observedKeys.filter((k) => !pinnedKeys.includes(k));
  const removed = pinnedKeys.filter((k) => !observedKeys.includes(k));
  // Carries the FULL pinned/observed shapes (not just key names) so a human
  // reviewer sees real field values, not merely which fields changed — this
  // is exactly the provider-body-shaped data 16's redaction discipline
  // exists to protect, so it is redacted as a whole below, never partially.
  const rawDiff = {
    connector: snapshot.connector,
    pinnedVersion: snapshot.pinnedVersion,
    observedVersion: snapshot.observedVersion,
    addedKeys: added,
    removedKeys: removed,
    pinnedShape: snapshot.pinnedShape,
    observedShape: snapshot.observedShape,
  };
  // MINOR-1 fix (adversarial-validation round): key-name-based redaction
  // alone (`redactSecretBearingObject`) only catches a secret sitting under
  // a secret-NAMED key — a token embedded in a non-secret-named field's free
  // text (e.g. an `errorBody` string) survives it untouched. 16/20's own
  // redaction discipline pairs it with CONTENT-shaped redaction
  // (`redactCredentialShapedText`) for exactly this case (their own
  // notification-template-body handling is the precedent). Both are applied
  // here, in sequence, over the full serialized diff.
  const redactedDiff = redactCredentialShapedText(
    JSON.stringify(redactSecretBearingObject(rawDiff)),
  );

  const recommendedFixtureUpdate =
    removed.length > 0 || added.length > 0
      ? `update pinned ${snapshot.connector} fixture from ${snapshot.pinnedVersion} to ${snapshot.observedVersion}; field/capability changes — added: [${added.join(", ")}], withdrawn: [${removed.join(", ")}]`
      : `update pinned ${snapshot.connector} fixture from ${snapshot.pinnedVersion} to ${snapshot.observedVersion} (version bump only, no shape change)`;

  return {
    drifted: true,
    proposal: {
      connector: snapshot.connector,
      pinnedVersion: snapshot.pinnedVersion,
      observedVersion: snapshot.observedVersion,
      redactedDiff,
      recommendedFixtureUpdate,
      detectedAt: now().toISOString(),
    },
  };
}
