import { describe, expect, it } from "vitest";
import { CliUsageError } from "../errors.js";
import { toStoredSecretRef } from "./stored-secret-ref.js";

/**
 * The CLI's argv reference vocabulary is WIDER than the stored contract's
 * three backends, so this conversion is a narrowing — and refusing the
 * forms that have no faithful representation is the correct behavior, not
 * a shortcoming. Coercing `op://vault/item` into some backend would
 * invent a resolution mechanism the operator never asked for.
 */
describe("toStoredSecretRef", () => {
  it("converts an env reference", () => {
    expect(toStoredSecretRef("env:JIRA_TOKEN")).toEqual({
      backend: "env",
      variable: "JIRA_TOKEN",
    });
  });

  it("converts a file reference to an absolute path", () => {
    expect(toStoredSecretRef("file:///run/secrets/jira")).toEqual({
      backend: "file",
      path: "/run/secrets/jira",
    });
  });

  it.each(["op://vault/item", "vault://kv/jira", "ref:some-id"])(
    "refuses %s rather than inventing a backend for it",
    (raw) => {
      expect(() => toStoredSecretRef(raw)).toThrow(CliUsageError);
    },
  );

  it("names the scheme it refused, so the operator can see which form failed", () => {
    expect(() => toStoredSecretRef("op://vault/item")).toThrow(/op:/);
  });
});
