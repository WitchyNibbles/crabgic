import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import {
  bindRemoteResourceEvidence,
  MissingConfirmedRevisionError,
  UnbindableRemoteResourceKindError,
} from "./remote-resource-binding.js";
import { findRemoteResourcePointersForRequirement } from "./remote-evidence-pointer.js";

/**
 * roadmap/21-connector-evidence-integration.md work item 1 — the WRITER
 * half. Until this module existed, `stampJiraRemoteResource`,
 * `stampGrafanaRemoteResource` and `recordEvidencePointer` had ZERO
 * production callers anywhere in the repository (definitions, barrel
 * re-exports and `.test.ts` only), so a live tenant produced zero
 * `RemoteResource`s and zero evidence pointers, and
 * `buildTraceabilityView` — which derives its bindings EXCLUSIVELY from
 * pointers — could never bind anything.
 *
 * The confirmed revision is taken from `MutationApplyResult.appliedRevision`
 * (`@crabgic/gateway`'s mutation pipeline: "the confirmed remote revision this
 * record's read-back step observed"), never from a caller-supplied literal.
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function baseInput() {
  return {
    requirementId: randomUUID(),
    changeSetId: randomUUID(),
    objectId: "a".repeat(40),
    externalConnectionId: randomUUID(),
    observedAt: "2026-07-26T00:00:00.000Z",
  };
}

describe("bindRemoteResourceEvidence — Grafana dashboard", () => {
  it("stamps a RemoteResource carrying the pipeline's appliedRevision and journals a decodable pointer", async () => {
    const base = baseInput();
    const binding = await bindRemoteResourceEvidence(tj.store, {
      ...base,
      target: { provider: "grafana", kind: "dashboard", externalId: "eo-rel-dash" },
      applied: { appliedRevision: "7" },
    });

    expect(binding.relation).toBe("dashboard");
    expect(binding.resource.revision).toBe("7");
    expect(binding.resource.resourceKind).toBe("dashboard");
    expect(binding.resource.externalId).toBe("eo-rel-dash");
    expect(binding.resource.externalConnectionId).toBe(base.externalConnectionId);
    expect(binding.resource.observedAt).toBe(base.observedAt);

    // The pointer this writer returns must be BYTE-IDENTICAL to what the
    // journal actually decodes back — otherwise the traceability view would
    // be built from an in-memory object the journal never agreed with.
    const decoded = await findRemoteResourcePointersForRequirement(tj.store, base.requirementId);
    expect(decoded).toEqual([binding.pointer]);
    expect(binding.pointer.confirmedRevision).toBe("7");
    expect(binding.pointer.remoteResourceId).toBe(binding.resource.id);
    expect(binding.pointer.objectId).toBe(base.objectId);
  });

  it("maps an alert-rule mutation to the `alert` relation", async () => {
    const base = baseInput();
    const binding = await bindRemoteResourceEvidence(tj.store, {
      ...base,
      target: { provider: "grafana", kind: "alert-rule", externalId: "eo-rel-alert" },
      applied: { appliedRevision: 'W/"3"' },
    });
    expect(binding.relation).toBe("alert");
    expect(binding.resource.revision).toBe('W/"3"');
  });

  it("carries an optional canonicalUrl straight onto the stamped resource", async () => {
    const base = baseInput();
    const binding = await bindRemoteResourceEvidence(tj.store, {
      ...base,
      target: { provider: "grafana", kind: "dashboard", externalId: "eo-rel-dash" },
      applied: { appliedRevision: "2" },
      canonicalUrl: "https://127.0.0.1:8443/d/eo-rel-dash",
    });
    expect(binding.resource.canonicalUrl).toBe("https://127.0.0.1:8443/d/eo-rel-dash");
  });

  it("omits canonicalUrl entirely when none is supplied (never an empty-string placeholder)", async () => {
    const base = baseInput();
    const binding = await bindRemoteResourceEvidence(tj.store, {
      ...base,
      target: { provider: "grafana", kind: "dashboard", externalId: "eo-rel-dash" },
      applied: { appliedRevision: "2" },
    });
    expect("canonicalUrl" in binding.resource).toBe(false);
  });

  it("defaults observedAt to the injected clock when the caller supplies none", async () => {
    const base = baseInput();
    const binding = await bindRemoteResourceEvidence(tj.store, {
      requirementId: base.requirementId,
      changeSetId: base.changeSetId,
      objectId: base.objectId,
      externalConnectionId: base.externalConnectionId,
      target: { provider: "grafana", kind: "dashboard", externalId: "eo-rel-dash" },
      applied: { appliedRevision: "2" },
      now: () => new Date("2031-01-02T03:04:05.000Z"),
    });
    expect(binding.resource.observedAt).toBe("2031-01-02T03:04:05.000Z");
  });
});

describe("bindRemoteResourceEvidence — Jira", () => {
  it("stamps an issue RemoteResource under the `tracking-issue` relation", async () => {
    const base = baseInput();
    const binding = await bindRemoteResourceEvidence(tj.store, {
      ...base,
      target: { provider: "jira", issueKey: "EO-1" },
      applied: { appliedRevision: "42" },
    });
    expect(binding.relation).toBe("tracking-issue");
    expect(binding.resource.resourceKind).toBe("issue");
    expect(binding.resource.externalId).toBe("EO-1");
    expect(binding.resource.revision).toBe("42");
  });
});

describe("bindRemoteResourceEvidence — fails closed, never binds a hollow pointer", () => {
  it("refuses an empty appliedRevision", async () => {
    const base = baseInput();
    await expect(
      bindRemoteResourceEvidence(tj.store, {
        ...base,
        target: { provider: "grafana", kind: "dashboard", externalId: "d" },
        applied: { appliedRevision: "" },
      }),
    ).rejects.toBeInstanceOf(MissingConfirmedRevisionError);
  });

  it("refuses a whitespace-only appliedRevision", async () => {
    const base = baseInput();
    await expect(
      bindRemoteResourceEvidence(tj.store, {
        ...base,
        target: { provider: "grafana", kind: "dashboard", externalId: "d" },
        applied: { appliedRevision: "   " },
      }),
    ).rejects.toBeInstanceOf(MissingConfirmedRevisionError);
  });

  it("writes NOTHING to the journal when it refuses", async () => {
    const base = baseInput();
    await expect(
      bindRemoteResourceEvidence(tj.store, {
        ...base,
        target: { provider: "grafana", kind: "dashboard", externalId: "d" },
        applied: { appliedRevision: "" },
      }),
    ).rejects.toBeInstanceOf(MissingConfirmedRevisionError);
    await expect(
      findRemoteResourcePointersForRequirement(tj.store, base.requirementId),
    ).resolves.toEqual([]);
  });

  it.each([
    "folder" as const,
    "annotation" as const,
    "contact-point" as const,
    "mute-timing" as const,
    "notification-template" as const,
  ])(
    "refuses Grafana kind %s — no `RemoteResourceRelation` member honestly describes it",
    async (kind) => {
      const base = baseInput();
      await expect(
        bindRemoteResourceEvidence(tj.store, {
          ...base,
          target: { provider: "grafana", kind, externalId: "x" },
          applied: { appliedRevision: "1" },
        }),
      ).rejects.toBeInstanceOf(UnbindableRemoteResourceKindError);
    },
  );

  it("names the offending kind in the refusal message", async () => {
    const base = baseInput();
    await expect(
      bindRemoteResourceEvidence(tj.store, {
        ...base,
        target: { provider: "grafana", kind: "folder", externalId: "x" },
        applied: { appliedRevision: "1" },
      }),
    ).rejects.toThrow(/folder/);
  });

  it("writes NOTHING to the journal when it refuses an unbindable kind", async () => {
    const base = baseInput();
    await expect(
      bindRemoteResourceEvidence(tj.store, {
        ...base,
        target: { provider: "grafana", kind: "folder", externalId: "x" },
        applied: { appliedRevision: "1" },
      }),
    ).rejects.toBeInstanceOf(UnbindableRemoteResourceKindError);
    await expect(
      findRemoteResourcePointersForRequirement(tj.store, base.requirementId),
    ).resolves.toEqual([]);
  });
});
