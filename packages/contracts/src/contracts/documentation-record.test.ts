import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CLAIMS_RESOLVE_CRITERION,
  DOCUMENT_FAILURE_MODES_CRITERION,
  DOCUMENT_USER_GUIDE_CRITERION,
  DocumentationRecordSchema,
  deriveDocumentationCriteria,
  documentationContradictions,
  unresolvableClaims,
  type DocumentationRecord,
} from "./documentation-record.js";

/**
 * The documentation stage's artifact — roadmap/25 work item 8.
 *
 * The owner's last step: "a group of specialized agents in documenting must
 * create user guides and maintenance guides that are easy to read and detailed".
 *
 * "Easy to read" is a judgement and is a LENS (`readability`, on the stage).
 * These criteria are the half a record can decide: coverage, and whether the
 * guide's claims are true. That second one is what separates a guide from a
 * plausible guide, and it is the only check here that catches the failure mode
 * documentation actually has — confident prose about a flag that does not exist.
 */

const record = (overrides: Partial<DocumentationRecord> = {}): DocumentationRecord =>
  DocumentationRecordSchema.parse({
    schemaVersion: 1,
    changeSetId: "22222222-3333-4444-8555-666666666666",
    userGuide: {
      path: "docs/user-guide.md",
      documentsCommands: ["crabgic run", "crabgic status"],
    },
    maintenanceGuide: {
      path: "docs/maintenance-guide.md",
      documentsFailureModes: ["gateway-unreachable"],
    },
    ...overrides,
  });

describe("DocumentationRecordSchema", () => {
  it("parses a record naming both guides", () => {
    expect(() => record()).not.toThrow();
  });

  it("refuses a guide with no path", () => {
    // A guide nobody can open is not a guide. The path is what makes the
    // record's claims checkable against a file.
    expect(
      DocumentationRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: "22222222-3333-4444-8555-666666666666",
        userGuide: { path: "", documentsCommands: ["crabgic run"] },
        maintenanceGuide: { path: "docs/m.md", documentsFailureModes: ["x"] },
      }).success,
    ).toBe(false);
  });

  it("requires BOTH guides, because the owner asked for both", () => {
    // A maintenance guide is not an optional extra here: the owner named user
    // guides AND maintenance guides. An optional field would let the stage
    // close having written one.
    expect(
      DocumentationRecordSchema.safeParse({
        schemaVersion: 1,
        changeSetId: "22222222-3333-4444-8555-666666666666",
        userGuide: { path: "docs/u.md", documentsCommands: ["crabgic run"] },
      }).success,
    ).toBe(false);
  });
});

describe("deriveDocumentationCriteria — user-guide coverage", () => {
  const surface = {
    commands: ["crabgic run", "crabgic status"],
    failureModes: ["gateway-unreachable"],
  };

  it("derives coverage when every public command is documented", () => {
    expect(deriveDocumentationCriteria(record(), surface)).toContain(DOCUMENT_USER_GUIDE_CRITERION);
  });

  it("does NOT derive it when a command went undocumented", () => {
    const partial = { ...surface, commands: [...surface.commands, "crabgic doctor"] };
    expect(deriveDocumentationCriteria(record(), partial)).not.toContain(
      DOCUMENT_USER_GUIDE_CRITERION,
    );
  });

  it("does NOT derive it from an EMPTY surface", () => {
    // The vacuity rule. "Every command is documented" over a surface nobody
    // supplied is trivially true, and would close the stage on an empty guide.
    expect(deriveDocumentationCriteria(record(), { commands: [], failureModes: [] })).not.toContain(
      DOCUMENT_USER_GUIDE_CRITERION,
    );
  });

  it("derives failure-mode coverage when every mode the design names is documented", () => {
    expect(deriveDocumentationCriteria(record(), surface)).toContain(
      DOCUMENT_FAILURE_MODES_CRITERION,
    );
  });

  it("does NOT derive failure-mode coverage when one is missing", () => {
    const more = { ...surface, failureModes: ["gateway-unreachable", "journal-corrupt"] };
    expect(deriveDocumentationCriteria(record(), more)).not.toContain(
      DOCUMENT_FAILURE_MODES_CRITERION,
    );
  });
});

describe("unresolvableClaims — the check that separates a guide from a plausible guide", () => {
  const surface = { commands: ["crabgic run"], failureModes: ["gateway-unreachable"] };

  it("names a command the guide documents that does not exist", () => {
    // The failure mode documentation actually has: confident prose about a
    // command nobody shipped. Everything else here is coverage; this is truth.
    const invented = record({
      userGuide: {
        path: "docs/user-guide.md",
        documentsCommands: ["crabgic run", "crabgic teleport"],
      },
    });
    expect(unresolvableClaims(invented, surface)).toEqual(["crabgic teleport"]);
  });

  it("names a failure mode the maintenance guide invented", () => {
    const invented = record({
      maintenanceGuide: { path: "docs/m.md", documentsFailureModes: ["quantum-decoherence"] },
    });
    expect(unresolvableClaims(invented, surface)).toContain("quantum-decoherence");
  });

  it("names nothing when every claim resolves", () => {
    const exact = record({
      userGuide: { path: "docs/user-guide.md", documentsCommands: ["crabgic run"] },
    });
    expect(unresolvableClaims(exact, surface)).toEqual([]);
  });

  it("derives the claims criterion only when nothing is invented", () => {
    const exact = record({
      userGuide: { path: "docs/user-guide.md", documentsCommands: ["crabgic run"] },
    });
    expect(deriveDocumentationCriteria(exact, surface)).toContain(
      DOCUMENT_CLAIMS_RESOLVE_CRITERION,
    );
  });

  it("withholds the claims criterion when something was invented", () => {
    const invented = record({
      userGuide: { path: "docs/user-guide.md", documentsCommands: ["crabgic teleport"] },
    });
    expect(deriveDocumentationCriteria(invented, surface)).not.toContain(
      DOCUMENT_CLAIMS_RESOLVE_CRITERION,
    );
  });
});

describe("documentationContradictions", () => {
  const surface = { commands: ["crabgic run"], failureModes: ["gateway-unreachable"] };

  it("contradicts the claims criterion when the guide invented something", () => {
    // Distinct from "not derived": an invented command is evidence AGAINST the
    // criterion, so an attestation claiming it is void rather than unsupported.
    const invented = record({
      userGuide: { path: "docs/user-guide.md", documentsCommands: ["crabgic teleport"] },
    });
    expect(documentationContradictions(invented, surface)).toContain(
      DOCUMENT_CLAIMS_RESOLVE_CRITERION,
    );
  });

  it("reports nothing for a record that is merely thin", () => {
    // A guide covering one of two commands has not lied about anything. It has
    // not met the coverage criterion, which is a different state.
    const thin = record({
      userGuide: { path: "docs/user-guide.md", documentsCommands: ["crabgic run"] },
    });
    expect(
      documentationContradictions(thin, {
        ...surface,
        commands: ["crabgic run", "crabgic status"],
      }),
    ).toEqual([]);
  });
});
