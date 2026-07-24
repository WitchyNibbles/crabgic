import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ConnectorError } from "@eo/contracts";
import {
  assertCustomFieldWritesAreDiscovered,
  buildFieldMetadataIndex,
  KNOWN_JIRA_FIELD_SCHEMA_TYPES,
} from "./field-metadata.js";
import type { JiraFieldMetadata } from "../resource-client/types.js";

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
