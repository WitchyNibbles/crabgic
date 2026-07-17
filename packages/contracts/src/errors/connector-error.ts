import { z } from "zod";
import { NonEmptyStringSchema } from "../shared/ids.js";

/**
 * Canonical connector-error union — roadmap/02-contracts-and-schemas.md §In
 * scope, "Canonical connector errors" bullet; work item 4; Exit criteria
 * ("a type-level test proves no raw provider-body field is constructible on
 * the public type; every member has ≥1 round-trip fixture"). A closed,
 * exactly-10-member union every connector (16 gateway pipeline; 18/19 Jira;
 * 20 Grafana) maps every provider failure onto — "no raw Jira error body
 * crosses the boundary" (18), "no raw provider body in any error, log, or
 * artifact" (16's leak-hunt exit criterion), "every thrown error is one of
 * 02's 10 canonical members with no raw Grafana response body attached" (20).
 * 21's `remote_verification` gate additionally treats `unsupported` and
 * `ambiguous_write` as run-blocking outcomes.
 */
export const CONNECTOR_ERROR_KINDS = [
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
] as const;

export const ConnectorErrorKindSchema = z.enum(CONNECTOR_ERROR_KINDS);
export type ConnectorErrorKind = z.infer<typeof ConnectorErrorKindSchema>;

/**
 * The serialized, public shape of a canonical connector error — the only
 * shape that ever crosses a process boundary (an MCP tool result, a
 * gateway response, the `errorKind` companion data this phase's own
 * `RemoteOperationRecordSchema` carries). Deliberately carries only
 * redacted/derived data: member `kind`, a safe `message`, the `provider`
 * name, `retryable`, and a `redactedDetail` summary — never a raw
 * provider-body field, matching the exit criterion's "member kind, safe
 * message, provider name, retryability, redacted detail summary" framing
 * verbatim.
 *
 * `schemaVersion` decision (documented per this worker's brief, since the
 * Risks bullet's "schemaVersion is carried on every contract from day one"
 * note is scoped to the 21 listed record-shaped contracts): this shape
 * deliberately does NOT carry `schemaVersion`. It is not one of the 21
 * contracts roadmap/02 §In scope enumerates under "Contracts (zod + JSON
 * Schema export, 21)"; it has no dedicated `JournalEntryType` member of its
 * own (04/16 journal `remote_operation_record` entries instead, embedding
 * at most this shape's `kind` via `RemoteOperationRecordSchema.errorKind`);
 * and it is never durably stored as a standalone top-level entity with its
 * own lifecycle — only ever constructed, thrown/returned inline, and
 * optionally embedded inside an already-schemaVersioned contract. This
 * matches the precedent already set by this phase's other non-`id`-bearing
 * closed-union values (`RunLifecycleStateSchema`, `WorkUnitAttemptStatusSchema`,
 * `HighImpactCapabilityFlagSchema`), none of which carry `schemaVersion`
 * either. If a future phase needs to persist a connector error as its own
 * durable, independently-evolving record, that phase adds `schemaVersion`
 * at that time — it is not retrofitted here speculatively.
 */
export const ConnectorErrorDataSchema = z
  .object({
    kind: ConnectorErrorKindSchema,
    message: NonEmptyStringSchema,
    provider: NonEmptyStringSchema,
    retryable: z.boolean(),
    redactedDetail: NonEmptyStringSchema,
  })
  .strict();

export type ConnectorErrorData = z.infer<typeof ConnectorErrorDataSchema>;

/**
 * Constructor input. `rawProviderResponse` is deliberately accepted here —
 * "constructors force provider-body redaction" (roadmap/02) means the
 * constructor may READ a raw provider response to derive `redactedDetail`
 * from it, never that the constructor refuses to see one. What it must
 * never do is store it: `ConnectorError`'s declared instance fields (below)
 * and `ConnectorErrorData` both omit it entirely, at the type level, not
 * merely by runtime convention.
 */
export interface ConnectorErrorInput {
  readonly message: string;
  readonly provider: string;
  readonly retryable: boolean;
  /** Accepted for redaction derivation only — never stored, never returned. */
  readonly rawProviderResponse?: unknown;
  /** Explicit override; when omitted, derived from `rawProviderResponse` via `redactProviderResponse`. */
  readonly redactedDetail?: string;
}

/**
 * Derives a safe summary from a raw provider response without ever
 * including its values — only top-level key names (for an object) or the
 * primitive's `typeof`, matching "redacted detail summary" from the exit
 * criterion. This is the one place in this module permitted to inspect
 * `rawProviderResponse`'s contents; its return value is the only trace of
 * that input that survives into `ConnectorError`/`ConnectorErrorData`.
 */
function redactProviderResponse(raw: unknown): string {
  if (raw === undefined) {
    return "(no provider response captured)";
  }
  if (raw === null) {
    return "(provider response: null)";
  }
  if (typeof raw !== "object") {
    return `(provider response: ${typeof raw})`;
  }
  const keys = Object.keys(raw as Record<string, unknown>).sort();
  return `(provider response object; top-level keys: ${keys.length > 0 ? keys.join(", ") : "none"})`;
}

/**
 * The public connector-error type. Every instance is produced by one of the
 * 10 named static constructors below (never `new ConnectorError(...)`
 * directly — the constructor is private) and exposes exactly `kind`,
 * `provider`, `retryable`, `redactedDetail`, plus the inherited `Error`
 * fields (`message`, `name`, `stack`). There is no `rawProviderBody`/
 * `rawProviderResponse` property anywhere on this class — not runtime-
 * stripped, never declared — so `err.rawProviderResponse` fails
 * `npx tsc -b packages/contracts` (see `connector-error.test.ts`'s
 * `@ts-expect-error` assertions), the exit criterion's "unconstructible at
 * the type level," not merely "redacted at runtime."
 */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  readonly redactedDetail: string;

  private constructor(kind: ConnectorErrorKind, input: ConnectorErrorInput) {
    super(input.message);
    this.name = "ConnectorError";
    this.kind = kind;
    this.provider = input.provider;
    this.retryable = input.retryable;
    this.redactedDetail = input.redactedDetail ?? redactProviderResponse(input.rawProviderResponse);
    // Defense-in-depth (coding-style: "validate at system boundaries"): a
    // constructed error must itself satisfy the serialized shape's own
    // schema before it is handed back to a caller.
    ConnectorErrorDataSchema.parse(this.toData());
    Object.freeze(this);
  }

  /** The serialized public shape — round-trips through `ConnectorErrorDataSchema`. Never carries `rawProviderResponse`. */
  toData(): ConnectorErrorData {
    return {
      kind: this.kind,
      message: this.message,
      provider: this.provider,
      retryable: this.retryable,
      redactedDetail: this.redactedDetail,
    };
  }

  /** Rehydrates a `ConnectorError` from its already-redacted serialized shape (e.g. after crossing a process/MCP boundary). */
  static fromData(data: ConnectorErrorData): ConnectorError {
    return new ConnectorError(data.kind, {
      message: data.message,
      provider: data.provider,
      retryable: data.retryable,
      redactedDetail: data.redactedDetail,
    });
  }

  static authentication(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("authentication", input);
  }

  static permission(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("permission", input);
  }

  static notFound(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("not_found", input);
  }

  static conflict(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("conflict", input);
  }

  static rateLimited(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("rate_limited", input);
  }

  static validation(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("validation", input);
  }

  static unsupported(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("unsupported", input);
  }

  static ambiguousWrite(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("ambiguous_write", input);
  }

  static transient(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("transient", input);
  }

  static policyBlocked(input: ConnectorErrorInput): ConnectorError {
    return new ConnectorError("policy_blocked", input);
  }
}
