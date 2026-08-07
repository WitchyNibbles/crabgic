import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ConnectorError } from "@crabgic/contracts";
import {
  assertCustomFieldWritesAreDiscovered,
  buildFieldMetadataIndex,
  CLOUD_CUSTOM_FIELD_REFUSAL,
  DATACENTER_CUSTOM_FIELD_REFUSAL,
  KNOWN_JIRA_FIELD_SCHEMA_TYPES,
} from "./field-metadata.js";
import type { JiraFieldMetadata } from "../resource-client/types.js";

/** Captures the thrown `ConnectorError` — `.toThrow(ConnectorError)` passes for every kind, which is exactly what left this path unpinned (`docs/verification-playbook.md` §"ASSERT THE TYPED KIND, NOT JUST THE THROW"). */
function catchConnectorError(run: () => void): ConnectorError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(ConnectorError);
    return err as ConnectorError;
  }
  throw new Error("expected assertCustomFieldWritesAreDiscovered to throw, it did not");
}

function field(overrides: Partial<JiraFieldMetadata> = {}): JiraFieldMetadata {
  return {
    id: "customfield_10010",
    name: "Story Points",
    custom: true,
    schemaType: "number",
    ...overrides,
  };
}

describe("assertCustomFieldWritesAreDiscovered", () => {
  it("passes when every custom field id is discovered with a known schema type", () => {
    const index = buildFieldMetadataIndex([field()]);
    expect(() =>
      assertCustomFieldWritesAreDiscovered({ customfield_10010: 5 }, index),
    ).not.toThrow();
  });

  it("never touches standard (non-custom-prefixed) fields", () => {
    const index = buildFieldMetadataIndex([]);
    expect(() => assertCustomFieldWritesAreDiscovered({ summary: "hello" }, index)).not.toThrow();
  });

  it("rejects a custom field id absent from discovered metadata", () => {
    const index = buildFieldMetadataIndex([]);
    expect(() => assertCustomFieldWritesAreDiscovered({ customfield_99999: "x" }, index)).toThrow(
      ConnectorError,
    );
  });

  it("rejects a discovered custom field whose schema type is unrecognized", () => {
    const index = buildFieldMetadataIndex([field({ schemaType: "some-future-jira-type" })]);
    expect(() => assertCustomFieldWritesAreDiscovered({ customfield_10010: "x" }, index)).toThrow(
      ConnectorError,
    );
  });

  // roadmap/19 criterion 2 (fields half) + defect
  // `19-unsupported-fields-and-cassette-conjuncts`: the refusal's canonical
  // kind and provider are now a PARAMETER of this shared gate, not a
  // hardcode. These four cases pin both settings of that parameter in both
  // branches, so neither the Cloud default nor the Data Center override can
  // drift silently. Before this suite existed, NOTHING in the repository
  // asserted the kind or the provider of either branch.
  describe("refusal attribution (kind + provider) is parameterized, and both settings are pinned", () => {
    it("defaults to Cloud attribution — validation/jira-cloud — for an undiscovered custom field", () => {
      const index = buildFieldMetadataIndex([]);
      const err = catchConnectorError(() =>
        assertCustomFieldWritesAreDiscovered({ customfield_99999: "x" }, index),
      );
      expect(err.kind).toBe("validation");
      expect(err.provider).toBe("jira-cloud");
      expect(err.message).toContain("not present in discovered field metadata");
    });

    it("defaults to Cloud attribution — validation/jira-cloud — for an unrecognized schema type", () => {
      const index = buildFieldMetadataIndex([field({ schemaType: "some-future-jira-type" })]);
      const err = catchConnectorError(() =>
        assertCustomFieldWritesAreDiscovered({ customfield_10010: "x" }, index),
      );
      expect(err.kind).toBe("validation");
      expect(err.provider).toBe("jira-cloud");
      expect(err.message).toContain("unrecognized schema type");
    });

    it("carries Data Center attribution — unsupported/jira-datacenter — for an undiscovered custom field", () => {
      const index = buildFieldMetadataIndex([]);
      const err = catchConnectorError(() =>
        assertCustomFieldWritesAreDiscovered(
          { customfield_99999: "x" },
          index,
          DATACENTER_CUSTOM_FIELD_REFUSAL,
        ),
      );
      expect(err.kind).toBe("unsupported");
      expect(err.provider).toBe("jira-datacenter");
      expect(err.message).toContain("not present in discovered field metadata");
    });

    it("carries Data Center attribution — unsupported/jira-datacenter — for an unrecognized schema type", () => {
      const index = buildFieldMetadataIndex([field({ schemaType: "some-future-jira-type" })]);
      const err = catchConnectorError(() =>
        assertCustomFieldWritesAreDiscovered(
          { customfield_10010: "x" },
          index,
          DATACENTER_CUSTOM_FIELD_REFUSAL,
        ),
      );
      expect(err.kind).toBe("unsupported");
      expect(err.provider).toBe("jira-datacenter");
      expect(err.message).toContain("unrecognized schema type");
    });

    it("the two exported attributions are distinct on BOTH members — so neither can be satisfied by the other", () => {
      expect(CLOUD_CUSTOM_FIELD_REFUSAL.kind).not.toBe(DATACENTER_CUSTOM_FIELD_REFUSAL.kind);
      expect(CLOUD_CUSTOM_FIELD_REFUSAL.provider).not.toBe(
        DATACENTER_CUSTOM_FIELD_REFUSAL.provider,
      );
    });
  });

  it("property: an unrecognized field schema type is never silently accepted for a custom-field write", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter((s) => !(KNOWN_JIRA_FIELD_SCHEMA_TYPES as readonly string[]).includes(s)),
        fc.anything(),
        (schemaType, value) => {
          const index = buildFieldMetadataIndex([field({ schemaType })]);
          expect(() =>
            assertCustomFieldWritesAreDiscovered({ customfield_10010: value }, index),
          ).toThrow(ConnectorError);
        },
      ),
    );
  });

  it("property: any custom field id never present in the discovered set is always rejected", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^customfield_[0-9]{5}$/), fc.anything(), (fieldId, value) => {
        const index = buildFieldMetadataIndex([field({ id: "customfield_00000" })]);
        fc.pre(fieldId !== "customfield_00000");
        expect(() => assertCustomFieldWritesAreDiscovered({ [fieldId]: value }, index)).toThrow(
          ConnectorError,
        );
      }),
    );
  });
});
