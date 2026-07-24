import type { ConnectorErrorKind } from "@eo/contracts";
import { findRemoteResourcePointersForRequirement } from "./remote-evidence-pointer.js";
import type { GateHandler, GateVerdict } from "./types.js";

/**
 * `remote_verification` gate — roadmap/21-connector-evidence-integration.md
 * work item 3: registers into 14's contract-risk-tag gate framework;
 * blocks the Run lifecycle's `final_verifying`→`published_local` transition
 * (02) for any requirement with an unbound evidence pointer, or whose
 * remote operation resolved to canonical `unsupported`/`ambiguous_write`
 * (02's 10-member connector-error union) — never a silent pass, never an
 * informal 11th error code.
 *
 * The caller (whoever fires this gate for a requirement) declares which
 * `RemoteResource` id(s) that requirement is REQUIRED to be bound to via
 * `requiredRemoteResourceIds` — a requirement that tracks nothing remote at
 * all (the common case) passes trivially with an empty list; this gate has
 * no way to invent a tracking requirement the caller never declared.
 *
 * MAJOR-1 fix (adversarial-validation round): a REAL run has MANY
 * requirements, each with its OWN required RemoteResource id(s)/connector
 * outcome, but ONE registered `GateHandler` instance is reused across every
 * `registry.fireByTag(...)` call in that run (one call per requirement's
 * `GateContext`). A single fixed `requiredRemoteResourceIds`/
 * `connectorOutcome` value can only ever describe ONE requirement. Both
 * fields now ALSO accept a resolver function
 * `(requirementId) => ...`, looked up against `context.requirementId` on
 * every firing — this is what lets ONE gate registration correctly verify
 * an entire multi-requirement `ChangeSet` end to end (see
 * `remote-verification-e2e.test.ts`). A plain fixed value remains supported
 * unchanged for the common single-requirement/unit-test case.
 */
export type RequiredRemoteResourceIdsInput =
  readonly string[] | ((requirementId: string | undefined) => readonly string[]);

export type ConnectorOutcomeInput =
  | ConnectorErrorKind
  | undefined
  | ((requirementId: string | undefined) => ConnectorErrorKind | undefined);

export interface RemoteVerificationGateInput {
  /** RemoteResource ids this requirement MUST have a bound `evidence_pointer` for; `[]`/omitted means "nothing tracked, nothing to verify." Accepts a fixed list OR a per-requirement resolver function. */
  readonly requiredRemoteResourceIds?: RequiredRemoteResourceIdsInput;
  /** The canonical outcome 18/20's mutation pipeline resolved this requirement's remote operation to, if any. `unsupported`/`ambiguous_write` always block, regardless of pointer state. Accepts a fixed value OR a per-requirement resolver function. */
  readonly connectorOutcome?: ConnectorOutcomeInput;
}

const BLOCKING_CONNECTOR_OUTCOMES: ReadonlySet<ConnectorErrorKind> = new Set([
  "unsupported",
  "ambiguous_write",
]);

function verdict(passed: boolean, detail: string, artifactDigests: readonly string[]): GateVerdict {
  return {
    passed,
    command: "remote_verification",
    exitStatus: passed ? 0 : 1,
    toolchainFingerprint: "remote_verification@1",
    artifactDigests,
    detail,
  };
}

function resolveRequiredRemoteResourceIds(
  input: RequiredRemoteResourceIdsInput | undefined,
  requirementId: string | undefined,
): readonly string[] {
  if (input === undefined) return [];
  return typeof input === "function" ? input(requirementId) : input;
}

function resolveConnectorOutcome(
  input: ConnectorOutcomeInput | undefined,
  requirementId: string | undefined,
): ConnectorErrorKind | undefined {
  return typeof input === "function" ? input(requirementId) : input;
}

export function createRemoteVerificationGate(input: RemoteVerificationGateInput = {}): GateHandler {
  return async (context) => {
    const connectorOutcome = resolveConnectorOutcome(input.connectorOutcome, context.requirementId);
    if (connectorOutcome !== undefined && BLOCKING_CONNECTOR_OUTCOMES.has(connectorOutcome)) {
      return verdict(
        false,
        `blocked: remote operation resolved to canonical "${connectorOutcome}" — never a silent pass`,
        [],
      );
    }

    const required = resolveRequiredRemoteResourceIds(
      input.requiredRemoteResourceIds,
      context.requirementId,
    );
    if (required.length === 0) {
      return verdict(true, "no remote-tracked resources declared for this requirement", []);
    }

    if (context.requirementId === undefined) {
      return verdict(
        false,
        "requiredRemoteResourceIds declared but the firing context carries no requirementId to resolve pointers against",
        [],
      );
    }

    const pointers = await findRemoteResourcePointersForRequirement(
      context.journal,
      context.requirementId,
    );
    const bound = new Set(pointers.map((p) => p.remoteResourceId));
    const unbound = required.filter((id) => !bound.has(id));
    // MAJOR-1 fix (adversarial-validation round): a second digest per
    // pointer literally carries the confirmed remote revision (when one is
    // known) — this is what makes "every requirement's EvidenceRecord
    // carries a confirmed remote revision" (exit criterion 1) an inspectable
    // fact about the emitted evidence, not merely an implication of the
    // pass/fail verdict.
    const artifactDigests = pointers.flatMap((p) => [
      `remote-resource:${p.remoteResourceId}:${p.relation}`,
      ...(p.confirmedRevision !== undefined
        ? [`confirmed-revision:${p.remoteResourceId}:${p.confirmedRevision}`]
        : []),
    ]);

    if (unbound.length > 0) {
      return verdict(
        false,
        `blocked: unbound evidence pointer(s) for requirement — missing RemoteResource id(s): ${unbound.join(", ")}`,
        artifactDigests,
      );
    }

    return verdict(
      true,
      `all ${String(required.length)} required RemoteResource pointer(s) bound with a confirmed revision`,
      artifactDigests,
    );
  };
}
