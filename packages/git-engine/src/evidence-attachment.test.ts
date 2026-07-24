import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyRegistry, createJournalStore, type JournalStore } from "@eo/journal";
import {
  attachEvidence,
  EvidenceAttachmentConflictError,
  type EvidenceAttachmentSource,
} from "./evidence-attachment.js";

/**
 * roadmap/08-integration-publication.md work item 5 — Failing-first per the
 * roadmap's own text: "a fixture `ChangeSet` must yield exactly zero
 * attached `EvidenceRecord`s before the routine exists, then exactly three
 * (one per `ArtifactKind`) after, each referencing a distinct lint-passed
 * `RenderedArtifact`." The "zero before" half of that claim is evidenced by
 * this file's own git history (this suite did not exist until the routine
 * did — see docs/evidence/phase-08); this suite itself proves the "exactly
 * three after" half.
 */

let journalDir: string;
let journal: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-git-engine-evidence-attachment-"));
  journal = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

function cleanSource(overrides: Partial<EvidenceAttachmentSource> = {}): EvidenceAttachmentSource {
  return {
    type: "fix",
    scope: "parser",
    outcome: "correct the off-by-one in the tokenizer",
    validation: "unit test added; full suite green",
    risk: "low — isolated to the tokenizer boundary check",
    tracking: "PROJ-123",
    finding: "off-by-one on the final token",
    evidence: "unit test tokenizer.test.ts:42",
    action: "fixed the boundary check",
    ...overrides,
  };
}

const OBJECT_ID = "a".repeat(40);

describe("attachEvidence", () => {
  it("attaches exactly 3 EvidenceRecords (one per ArtifactKind), each referencing a distinct RenderedArtifact digest", async () => {
    const idempotency = new IdempotencyRegistry(journal);
    const result = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000001",
      source: cleanSource(),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });

    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.map((o) => o.kind)).toEqual(["pr_title", "pr_body", "review_comment"]);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("attached");
      if (outcome.status === "attached") {
        expect(outcome.evidenceRecord.changeSetId).toBe("a0000000-0000-4000-8000-000000000001");
        expect(outcome.evidenceRecord.objectId).toBe(OBJECT_ID);
      }
    }
    const digests = result.outcomes
      .filter((o) => o.status === "attached")
      .map((o) => (o.status === "attached" ? o.evidenceRecord.artifactDigests[0] : undefined));
    expect(new Set(digests).size).toBe(3); // each references a DISTINCT rendered artifact

    const journaled: unknown[] = [];
    for await (const entry of journal.queryEntries({
      type: "evidence_pointer",
      changeSetId: "a0000000-0000-4000-8000-000000000001",
    })) {
      journaled.push(entry);
    }
    expect(journaled).toHaveLength(3);
  });

  it("renders pr_title without a scope segment when scope is omitted from the source", async () => {
    const idempotency = new IdempotencyRegistry(journal);
    const { scope, ...withoutScope } = cleanSource();
    void scope;
    const result = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000006",
      source: withoutScope,
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });

    const prTitleOutcome = result.outcomes.find((o) => o.kind === "pr_title")!;
    expect(prTitleOutcome.status).toBe("attached");
    if (prTitleOutcome.status === "attached") {
      expect(prTitleOutcome.evidenceRecord.artifactDigests[0]).toBeDefined();
    }
  });

  it("blocks the affected kind(s) when a field carries an attribution leak, without throwing", async () => {
    const idempotency = new IdempotencyRegistry(journal);
    const result = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000002",
      source: cleanSource({ finding: "🤖 Generated with Claude Code" }),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });

    const reviewOutcome = result.outcomes.find((o) => o.kind === "review_comment")!;
    expect(reviewOutcome.status).toBe("blocked");
  });

  it("2026-07-24 LOW-MEDIUM fix — partial-block recovery: fixing ONE blocked kind's own field never disturbs the other already-attached kinds, and the fixed kind then attaches", async () => {
    const idempotency = new IdempotencyRegistry(journal);
    const changeSetId = "a0000000-0000-4000-8000-000000000007";

    // First run: `finding` (consumed ONLY by review_comment) carries an
    // attribution leak — pr_title/pr_body attach cleanly, review_comment
    // blocks.
    const first = await attachEvidence({
      changeSetId,
      source: cleanSource({ finding: "🤖 Generated with Claude Code" }),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });
    const firstPrTitle = first.outcomes.find((o) => o.kind === "pr_title")!;
    const firstPrBody = first.outcomes.find((o) => o.kind === "pr_body")!;
    const firstReviewComment = first.outcomes.find((o) => o.kind === "review_comment")!;
    expect(firstPrTitle.status).toBe("attached");
    expect(firstPrBody.status).toBe("attached");
    expect(firstReviewComment.status).toBe("blocked");

    // Second run: ONLY `finding` is fixed — every field pr_title/pr_body
    // actually consume (type/scope/outcome/validation/risk/tracking) is
    // byte-identical to the first run. Before the fix, this would have
    // thrown EvidenceAttachmentConflictError on pr_title (the FIRST kind
    // the loop reaches), before review_comment's own fix was ever even
    // attempted.
    const second = await attachEvidence({
      changeSetId,
      source: cleanSource({ finding: "off-by-one, fixed and re-verified" }),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });
    const secondPrTitle = second.outcomes.find((o) => o.kind === "pr_title")!;
    const secondPrBody = second.outcomes.find((o) => o.kind === "pr_body")!;
    const secondReviewComment = second.outcomes.find((o) => o.kind === "review_comment")!;

    // The unaffected kinds replayed the SAME durable record — no
    // conflict, no duplicate.
    expect(secondPrTitle.status).toBe("attached");
    expect(secondPrBody.status).toBe("attached");
    if (secondPrTitle.status === "attached" && firstPrTitle.status === "attached") {
      expect(secondPrTitle.evidenceRecord.id).toBe(firstPrTitle.evidenceRecord.id);
    }
    if (secondPrBody.status === "attached" && firstPrBody.status === "attached") {
      expect(secondPrBody.evidenceRecord.id).toBe(firstPrBody.evidenceRecord.id);
    }

    // The FIXED kind genuinely recovered: it now attaches (a fresh
    // EvidenceRecord — it was never durably recorded before, since a
    // blocked attempt is never journaled).
    expect(secondReviewComment.status).toBe("attached");

    const journaled: unknown[] = [];
    for await (const entry of journal.queryEntries({ type: "evidence_pointer", changeSetId })) {
      journaled.push(entry);
    }
    // pr_title + pr_body (run 1) + review_comment (run 2, the recovery) —
    // never duplicated, never blocked forever.
    expect(journaled).toHaveLength(3);
  });

  it("is idempotent: re-running with the SAME source never duplicates EvidenceRecords/journal entries", async () => {
    const idempotency = new IdempotencyRegistry(journal);
    const first = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000003",
      source: cleanSource(),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });
    const second = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000003",
      source: cleanSource(),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });

    const firstIds = first.outcomes.map((o) =>
      o.status === "attached" ? o.evidenceRecord.id : undefined,
    );
    const secondIds = second.outcomes.map((o) =>
      o.status === "attached" ? o.evidenceRecord.id : undefined,
    );
    expect(secondIds).toEqual(firstIds); // byte-identical replay, not a fresh record

    const journaled: unknown[] = [];
    for await (const entry of journal.queryEntries({
      type: "evidence_pointer",
      changeSetId: "a0000000-0000-4000-8000-000000000003",
    })) {
      journaled.push(entry);
    }
    expect(journaled).toHaveLength(3); // still exactly 3 — the replay appended nothing
  });

  it("survives a BRAND NEW IdempotencyRegistry instance pointed at the same journal (durable, not in-process-only)", async () => {
    const first = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000004",
      source: cleanSource(),
      objectId: OBJECT_ID,
      journal,
      idempotency: new IdempotencyRegistry(journal),
    });

    const second = await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000004",
      source: cleanSource(),
      objectId: OBJECT_ID,
      journal,
      idempotency: new IdempotencyRegistry(journal), // fresh instance, same durable journal
    });

    const firstIds = first.outcomes.map((o) =>
      o.status === "attached" ? o.evidenceRecord.id : undefined,
    );
    const secondIds = second.outcomes.map((o) =>
      o.status === "attached" ? o.evidenceRecord.id : undefined,
    );
    expect(secondIds).toEqual(firstIds);
  });

  it("throws EvidenceAttachmentConflictError when a re-run supplies DIFFERENT source content for the same changeSetId", async () => {
    const idempotency = new IdempotencyRegistry(journal);
    await attachEvidence({
      changeSetId: "a0000000-0000-4000-8000-000000000005",
      source: cleanSource(),
      objectId: OBJECT_ID,
      journal,
      idempotency,
    });

    await expect(
      attachEvidence({
        changeSetId: "a0000000-0000-4000-8000-000000000005",
        source: cleanSource({ outcome: "a completely different outcome" }),
        objectId: OBJECT_ID,
        journal,
        idempotency,
      }),
    ).rejects.toBeInstanceOf(EvidenceAttachmentConflictError);
  });
});
