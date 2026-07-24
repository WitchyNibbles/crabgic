import { randomUUID } from "node:crypto";

/**
 * In-process attachment staging registry — the side channel
 * `../resource-client/comment-worklog-attachment-plans.ts`'s
 * `planAttachmentUpload` and the mutation-apply client
 * (`../resource-client/jira-mutation-apply-client.ts`) share so an
 * attachment's validated bytes never round-trip through the
 * `RemoteMutationPlan` JSON itself (roadmap/18 §In scope: "bytes never
 * enter prompts"). A caller stages ALREADY-VALIDATED
 * (`../attachments/attachment-pipeline.ts`) content once; the mutation-
 * apply client `take()`s it exactly once, at apply time, immediately
 * before building the multipart upload request — never held any longer
 * than that single apply call needs it for.
 */
export class AttachmentStagingNotFoundError extends Error {
  readonly stagingId: string;

  constructor(stagingId: string) {
    super(
      `no staged attachment found for stagingId "${stagingId}" (already consumed, or never staged)`,
    );
    this.name = "AttachmentStagingNotFoundError";
    this.stagingId = stagingId;
    Object.freeze(this);
  }
}

export interface StagedAttachment {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: Buffer;
}

export class AttachmentStagingRegistry {
  readonly #entries = new Map<string, StagedAttachment>();

  /** Registers already-validated attachment content, returning a fresh opaque stagingId. */
  stage(attachment: StagedAttachment): string {
    const stagingId = randomUUID();
    this.#entries.set(stagingId, attachment);
    return stagingId;
  }

  /** Consumes (removes) and returns the staged entry. Throws if absent — a plan replayed twice never re-uploads stale bytes from a dangling reference. */
  take(stagingId: string): StagedAttachment {
    const entry = this.#entries.get(stagingId);
    if (entry === undefined) {
      throw new AttachmentStagingNotFoundError(stagingId);
    }
    this.#entries.delete(stagingId);
    return entry;
  }
}
