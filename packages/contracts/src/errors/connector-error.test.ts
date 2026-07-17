import { describe, expect, it } from "vitest";
import {
  CONNECTOR_ERROR_KINDS,
  ConnectorError,
  ConnectorErrorDataSchema,
  ConnectorErrorKindSchema,
  type ConnectorErrorData,
} from "./connector-error.js";

describe("ConnectorErrorKindSchema — closed 10-member union", () => {
  it("has exactly 10 members (roadmap/02 §In scope, Canonical connector errors)", () => {
    expect(CONNECTOR_ERROR_KINDS.length).toBe(10);
  });

  it("byte-matches the roadmap's declared member list, in order", () => {
    expect(CONNECTOR_ERROR_KINDS).toEqual([
      "authentication",
      "permission",
      "not_found",
      "conflict",
      "rate_limited",
      "validation",
      "unsupported",
      "transient",
      "ambiguous_write",
      "policy_blocked",
    ]);
  });

  it("accepts every declared member", () => {
    for (const kind of CONNECTOR_ERROR_KINDS) {
      expect(ConnectorErrorKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects a kind outside the closed union", () => {
    expect(ConnectorErrorKindSchema.safeParse("timeout").success).toBe(false);
  });
});

const CONSTRUCTORS = [
  ["authentication", ConnectorError.authentication],
  ["permission", ConnectorError.permission],
  ["not_found", ConnectorError.notFound],
  ["conflict", ConnectorError.conflict],
  ["rate_limited", ConnectorError.rateLimited],
  ["validation", ConnectorError.validation],
  ["unsupported", ConnectorError.unsupported],
  ["transient", ConnectorError.transient],
  ["ambiguous_write", ConnectorError.ambiguousWrite],
  ["policy_blocked", ConnectorError.policyBlocked],
] as const;

describe("ConnectorError — one constructor per member, all 10 union branches", () => {
  it.each(CONSTRUCTORS)(
    "%s constructor produces an error carrying exactly that kind",
    (kind, ctor) => {
      const err = ctor({ message: `${kind} failure`, provider: "jira-cloud", retryable: false });
      expect(err.kind).toBe(kind);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ConnectorError);
    },
  );

  it.each(CONSTRUCTORS)(
    "%s: ≥1 round-trip fixture (construct -> toData -> JSON stringify -> parse -> deep-equal)",
    (kind, ctor) => {
      const err = ctor({
        message: `${kind} failure while calling the provider`,
        provider: "grafana-cloud",
        retryable: kind === "rate_limited" || kind === "transient",
        rawProviderResponse: { status: 500, body: { secretToken: "should-never-survive" } },
      });

      const data = err.toData();
      const serialized = JSON.stringify(data);
      const roundTripped = ConnectorErrorDataSchema.parse(JSON.parse(serialized));

      expect(roundTripped).toStrictEqual(data);
      expect(roundTripped.kind).toBe(kind);
      // the redacted-detail summary never contains the raw secret value
      expect(JSON.stringify(roundTripped)).not.toContain("should-never-survive");
    },
  );

  it("derives a key-names-only redaction summary from an object provider response, never raw values", () => {
    const err = ConnectorError.validation({
      message: "invalid field",
      provider: "jira-datacenter",
      retryable: false,
      rawProviderResponse: { errorMessages: ["do not leak me"], apiKey: "sk-should-not-appear" },
    });

    expect(err.redactedDetail).toContain("errorMessages");
    expect(err.redactedDetail).toContain("apiKey");
    expect(err.redactedDetail).not.toContain("do not leak me");
    expect(err.redactedDetail).not.toContain("sk-should-not-appear");
  });

  it("redacts a null provider response to a fixed marker, never a value", () => {
    const err = ConnectorError.transient({
      message: "upstream failure",
      provider: "grafana-oss",
      retryable: true,
      rawProviderResponse: null,
    });
    expect(err.redactedDetail).toBe("(provider response: null)");
  });

  it("redacts a primitive provider response to its typeof only — a raw string/HTML body never survives", () => {
    const err = ConnectorError.transient({
      message: "upstream 500",
      provider: "jira-datacenter",
      retryable: true,
      rawProviderResponse: "<html>500 secret-internal-hostname</html>",
    });
    expect(err.redactedDetail).toBe("(provider response: string)");
    expect(JSON.stringify(err.toData())).not.toContain("secret-internal-hostname");
  });

  it("accepts an explicit redactedDetail override instead of deriving one", () => {
    const err = ConnectorError.transient({
      message: "upstream 503",
      provider: "grafana-oss",
      retryable: true,
      redactedDetail: "upstream returned 503",
    });
    expect(err.redactedDetail).toBe("upstream returned 503");
  });

  it("round-trips through fromData(toData())", () => {
    const err = ConnectorError.notFound({
      message: "issue not found",
      provider: "jira-cloud",
      retryable: false,
    });
    const rehydrated = ConnectorError.fromData(err.toData());
    expect(rehydrated.toData()).toStrictEqual(err.toData());
  });
});

describe("ConnectorErrorDataSchema — invalid-shape and unknown-key rejection", () => {
  const valid: ConnectorErrorData = {
    kind: "authentication",
    message: "bad credentials",
    provider: "jira-cloud",
    retryable: false,
    redactedDetail: "authentication failed",
  };

  it("parses a fully-valid fixture", () => {
    expect(ConnectorErrorDataSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a kind outside the closed union", () => {
    expect(ConnectorErrorDataSchema.safeParse({ ...valid, kind: "timeout" }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { message: _message, ...rest } = valid;
    expect(ConnectorErrorDataSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(ConnectorErrorDataSchema.safeParse({ ...valid, message: "" }).success).toBe(false);
  });

  it("rejects an unknown top-level key (.strict())", () => {
    expect(
      ConnectorErrorDataSchema.safeParse({ ...valid, rawProviderBody: { leak: true } }).success,
    ).toBe(false);
  });
});

describe("ConnectorError — type-level security: the public type has no raw-body field", () => {
  it("rejects a raw-provider-body field on the serialized ConnectorErrorData shape at the type level", () => {
    const bad: ConnectorErrorData = {
      kind: "authentication",
      message: "invalid credentials",
      provider: "jira-cloud",
      retryable: false,
      redactedDetail: "authentication failed",
      // @ts-expect-error — `rawProviderBody` is not a key of `ConnectorErrorData`;
      // the exit criterion requires this to fail `npx tsc -b packages/contracts`,
      // not merely be stripped at runtime.
      rawProviderBody: { secret: "should never type-check" },
    };
    expect(bad).toBeDefined();
  });

  it("rejects reading a raw-provider-response field off a constructed ConnectorError instance", () => {
    const err = ConnectorError.authentication({
      message: "invalid credentials",
      provider: "jira-cloud",
      retryable: false,
      rawProviderResponse: { secret: "should never surface on the instance" },
    });

    // @ts-expect-error — `rawProviderResponse` is accepted by the constructor
    // input for redaction derivation only; it is never stored, so it is not a
    // property of the constructed `ConnectorError` instance's public type.
    expect(err.rawProviderResponse).toBeUndefined();
  });

  it("rejects passing an unknown extra field into a constructor's input at the type level", () => {
    ConnectorError.permission({
      message: "forbidden",
      provider: "grafana-enterprise",
      retryable: false,
      // @ts-expect-error — `ConnectorErrorInput` has no `rawProviderBody` key
      // (only `rawProviderResponse`, which is accepted, redacted, and discarded).
      rawProviderBody: { leak: true },
    });
  });
});
