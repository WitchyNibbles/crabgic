import { z } from "zod";

/**
 * The `docs/evidence/phase-23/requirement-traceability.json` artifact —
 * 21's `RemoteResource`s and evidence pointers for the release cut, plus
 * the provenance that says WHERE THEY CAME FROM.
 *
 * WHY PROVENANCE IS A FIRST-CLASS, SCHEMA-REQUIRED FIELD. roadmap/23:56 is
 * explicit that 23 "does not use `packages/testkit`'s fakes for its own
 * final verdicts ... against live or containerized real systems instead."
 * `packages/connectors-grafana`'s cassettes are HAND-AUTHORED, not recorded
 * (`fixtures/cassettes.ts`), so a cassette-derived `RemoteResource` in this
 * file would be a false green — indistinguishable, once written to disk,
 * from a genuine one. The only defence is that the artifact must state its
 * own origin on its face, and the reader must refuse any origin it does not
 * recognise. `source` is therefore a closed enum with exactly ONE member
 * today (`containerized`): a hand-edited `"live-saas"` label does not parse.
 *
 * The containerized binding reaches the container through the established
 * two-seam repo pattern (`packages/connectors-jira/src/testkit/custom-ca-
 * self-signed.integration.test.ts:99-100`): the SSRF-guard preflight sees a
 * fake non-loopback answer from `resolveHostAddresses`, and the actual dial
 * is pinned back to loopback by `sendHttpRequest`'s `pinnedAddress`. NO
 * production guard is relaxed — `ssrf-guard.ts` blocks `10/8, 172.16/12,
 * 192.168/16, 127/8, 169.254/16, 0.0.0.0/8`, and `203.0.113.0/24`
 * (TEST-NET-3) is not among them, so the guard passes on its own terms.
 * Both seams are recorded here verbatim so a reader can see exactly what
 * was substituted and reproduce the same run.
 */

export const TRACEABILITY_EVIDENCE_SCHEMA_VERSION = 1;

/** The ONLY recognised provenance today. Deliberately a one-member enum — see this module's doc comment. */
export const CONTAINERIZED_PROVENANCE_SOURCE = "containerized" as const;

/** The shared-journal switch every `e2e/` harness already honours (`./testJournal.ts`), and the one `e2e/report`'s generator reads its evidence from. */
export const SHARED_JOURNAL_ENV_VAR = "EO_RELEASE_GATE_JOURNAL_DIR";

/**
 * Says, on the artifact's face, whether its `pointers[].evidenceRecordId`
 * can actually be looked up.
 *
 * WHY THIS IS A REQUIRED FIELD (adversarial-validation MINOR-4): the binding
 * writer used to create its journal in an `mkdtemp` directory that teardown
 * then deleted, so the committed artifact's `evidenceRecordId` was a
 * permanently dangling reference — and roadmap/21 work item 1's actual
 * deliverable, the journal ENTRY, never reached the shared release journal
 * at all. Nothing on disk distinguished that from a resolvable id. It does
 * now, and the two dispositions read differently enough that no reader can
 * confuse them.
 */
export function describeEvidenceJournal(input: {
  readonly shared: boolean;
  readonly dir: string;
}): string {
  return input.shared
    ? `evidence journal: the shared release journal (${SHARED_JOURNAL_ENV_VAR}=${input.dir}) — ` +
        `the evidenceRecordId below resolves there, and e2e/report's generator reads the same ` +
        `directory.`
    : `evidence journal: a run-local temporary journal (${input.dir}), discarded at teardown — ` +
        `the evidenceRecordId below is NOT resolvable. Re-run with ${SHARED_JOURNAL_ENV_VAR} set ` +
        `to bind the record into the shared release journal.`;
}

/**
 * Mutation outcomes that constitute a genuinely confirmed remote revision.
 * `recorded` is a fresh apply + read-back verify; `replayed` is the
 * exactly-once pipeline returning the SAME previously-verified result for a
 * repeated idempotency key — both carry a revision the pipeline confirmed.
 * `conflict`/`blocked`/`failed` never do.
 */
const CONFIRMING_OUTCOMES = ["recorded", "replayed"] as const;

/**
 * `.passthrough()`, DELIBERATELY, and the two schemas below are the only place in this file where that is
 * true — everything from `provenance` upward is `.strict()`. The array ELEMENTS are producer-shaped: the
 * committed `docs/evidence/phase-23/requirement-traceability.json` already carries per-record `schemaVersion`
 * and `canonicalUrl` keys this reader has no use for, and the connector that writes them is free to add more.
 * Tightening either element schema to `.strict()` makes the real artifact unreadable — verified by mutation:
 * with `.strict()` here, parsing the committed file fails with
 * "remoteResources.0: Unrecognized key(s) in object: 'schemaVersion', 'canonicalUrl'".
 *
 * The tradeoff this buys, stated so it is not mistaken for an oversight: Gap 16 part (3)'s drift-surfacing
 * guarantee holds at the top level and throughout `provenance`, NOT inside `remoteResources[]`/`pointers[]`.
 * A producer that grows an unknown key on an element is half-read in silence. The fields this reader
 * actually depends on are all required above, so the silence costs recall of new fields, never correctness
 * of the ones scored. `docs/interface-ledger.md` Gap 16's "Known non-conformance" paragraph states the same
 * boundary; the two must move together.
 */
const RemoteResourceRecordSchema = z
  .object({
    id: z.string().min(1),
    externalConnectionId: z.string().min(1),
    resourceKind: z.string().min(1),
    externalId: z.string().min(1),
    revision: z.string().min(1),
    observedAt: z.string().min(1),
  })
  .passthrough();

/** `.passthrough()` for the same deliberate reason as `RemoteResourceRecordSchema` above — see that block. */
const PointerRecordSchema = z
  .object({
    requirementId: z.string().min(1),
    remoteResourceId: z.string().min(1),
    relation: z.enum(["tracking-issue", "dashboard", "alert"]),
    objectId: z.string().min(1),
    confirmedRevision: z.string().min(1).optional(),
    evidenceRecordId: z.string().min(1),
  })
  .passthrough();

export const TraceabilityProvenanceSchema = z
  .object({
    source: z.literal(CONTAINERIZED_PROVENANCE_SOURCE),
    statement: z.string().min(1),
    capturedAt: z.string().min(1),
    releaseCandidateObjectId: z.string().min(1),
    mutationOutcome: z.string().min(1),
    /** Composed by `describeEvidenceJournal` — where `pointers[].evidenceRecordId` lives, and whether it resolves at all. */
    evidenceJournal: z.string().min(1),
    container: z
      .object({
        image: z.string().min(1),
        composeFile: z.string().min(1),
        reportedVersion: z.string().min(1),
        edition: z.string().min(1),
      })
      .strict(),
    transportSeams: z
      .object({
        resolveHostAddresses: z.string().min(1),
        sendRequestPinnedAddress: z.string().min(1),
        tlsTermination: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const TraceabilityEvidenceFileSchema = z
  .object({
    schemaVersion: z.literal(TRACEABILITY_EVIDENCE_SCHEMA_VERSION),
    provenance: TraceabilityProvenanceSchema,
    remoteResources: z.array(RemoteResourceRecordSchema).readonly(),
    pointers: z.array(PointerRecordSchema).readonly(),
  })
  .strict();

export type TraceabilityProvenance = z.infer<typeof TraceabilityProvenanceSchema>;
export type TraceabilityEvidenceFile = z.infer<typeof TraceabilityEvidenceFileSchema>;

/** Everything except the derived `statement`, which this module composes so it can never drift from the recorded facts. */
export type TraceabilityProvenanceInput = Omit<TraceabilityProvenance, "statement">;

/** Structural (not zod-`input`) shapes, so the writer accepts `RemoteResource`/`RemoteEvidencePointer` instances straight off `@eo/gates`'s production binding without an index-signature cast. */
export interface TraceabilityResourceInput {
  readonly id: string;
  readonly externalConnectionId: string;
  readonly resourceKind: string;
  readonly externalId: string;
  readonly revision: string;
  readonly observedAt: string;
}

export interface TraceabilityPointerInput {
  readonly requirementId: string;
  readonly remoteResourceId: string;
  readonly relation: "tracking-issue" | "dashboard" | "alert";
  readonly objectId: string;
  readonly confirmedRevision?: string;
  readonly evidenceRecordId: string;
}

export interface BuildTraceabilityEvidenceFileInput {
  readonly provenance: TraceabilityProvenanceInput;
  readonly remoteResources: readonly TraceabilityResourceInput[];
  readonly pointers: readonly TraceabilityPointerInput[];
}

/** Composed from the recorded facts, never hand-written — so the sentence and the fields cannot disagree. */
function composeStatement(provenance: TraceabilityProvenanceInput): string {
  return (
    `This traceability evidence came from a CONTAINERIZED run against ` +
    `${provenance.container.image} (compose file ${provenance.container.composeFile}, reported ` +
    `${provenance.container.edition} ${provenance.container.reportedVersion}) — NOT a live-SaaS ` +
    `tenant, and not a cassette. The container was reached through the repo's established ` +
    `two-seam test pattern with the address-resolution seams ENGAGED: resolveHostAddresses was ` +
    `overridden to answer ${provenance.transportSeams.resolveHostAddresses} (TEST-NET-3, which ` +
    `ssrf-guard does not block, so the guard passed on its own terms and no production guard was ` +
    `modified), while the actual dial was pinned to ` +
    `${provenance.transportSeams.sendRequestPinnedAddress} via sendHttpRequest's pinnedAddress. ` +
    `TLS: ${provenance.transportSeams.tlsTermination}. The revision below is the confirmed ` +
    `MutationApplyResult.appliedRevision from a real executeMutationPlan run whose outcome was ` +
    `"${provenance.mutationOutcome}". ${provenance.evidenceJournal}`
  );
}

/**
 * Builds the artifact, refusing every shape that would make it a false
 * green. Each refusal is a hard throw at WRITE time (the harness that
 * produces this file is the only caller), never a soft degrade — a
 * half-true traceability artifact on disk is worse than none.
 */
export function buildTraceabilityEvidenceFile(
  input: BuildTraceabilityEvidenceFileInput,
): TraceabilityEvidenceFile {
  if (!(CONFIRMING_OUTCOMES as readonly string[]).includes(input.provenance.mutationOutcome)) {
    throw new Error(
      `traceability evidence: mutation outcome "${input.provenance.mutationOutcome}" is not a ` +
        `confirmed remote revision (expected one of ${CONFIRMING_OUTCOMES.join(", ")})`,
    );
  }
  if (input.pointers.length === 0) {
    throw new Error(
      "traceability evidence: no pointers — buildTraceabilityView derives its bindings " +
        "EXCLUSIVELY from pointers, so an artifact carrying only remoteResources binds nothing",
    );
  }
  const resourceIds = new Set(input.remoteResources.map((resource) => resource.id));
  for (const pointer of input.pointers) {
    if (!resourceIds.has(pointer.remoteResourceId)) {
      throw new Error(
        `traceability evidence: dangling pointer to RemoteResource "${pointer.remoteResourceId}" ` +
          `— no such resource in this artifact`,
      );
    }
    if (pointer.confirmedRevision === undefined || pointer.confirmedRevision.length === 0) {
      throw new Error(
        `traceability evidence: pointer for requirement "${pointer.requirementId}" carries no ` +
          `confirmed revision — that records "we pointed at it", not "we verified it"`,
      );
    }
  }

  return TraceabilityEvidenceFileSchema.parse({
    schemaVersion: TRACEABILITY_EVIDENCE_SCHEMA_VERSION,
    provenance: { ...input.provenance, statement: composeStatement(input.provenance) },
    remoteResources: input.remoteResources,
    pointers: input.pointers,
  });
}

export type ParseTraceabilityEvidenceResult =
  | { readonly ok: true; readonly file: TraceabilityEvidenceFile }
  | { readonly ok: false; readonly error: string };

/**
 * Parses the artifact, NEVER throwing. The previous reader did a bare
 * `JSON.parse(...) as TraceabilityInputFile`: malformed JSON threw straight
 * out of the check and aborted the whole release-evidence run, and a
 * structurally wrong file was silently accepted as `{}` — which the gate
 * then reported as "bound to no remote resource" rather than "your
 * traceability artifact is corrupt". Both are now stated reasons.
 */
export function parseTraceabilityEvidenceFile(raw: string): ParseTraceabilityEvidenceResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `not valid JSON (${err instanceof Error ? err.message : "unknown"})`,
    };
  }
  const parsed = TraceabilityEvidenceFileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `does not match the traceability-evidence schema (${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")})`,
    };
  }
  return { ok: true, file: parsed.data };
}

/** One quotable detail line, so the release-gate report itself states the binding's origin — not just the artifact on disk. */
export function describeProvenance(provenance: TraceabilityProvenance): string {
  return (
    `remote binding provenance: ${provenance.source} — ${provenance.container.image} ` +
    `(${provenance.container.edition} ${provenance.container.reportedVersion}) via ` +
    `${provenance.container.composeFile}; address-resolution seams engaged ` +
    `[resolveHostAddresses -> ${provenance.transportSeams.resolveHostAddresses}, dial pinned to ` +
    `${provenance.transportSeams.sendRequestPinnedAddress}]; mutation outcome ` +
    `"${provenance.mutationOutcome}" at ${provenance.capturedAt}. ${provenance.evidenceJournal}`
  );
}
