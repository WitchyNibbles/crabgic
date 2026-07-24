import { ConnectorError } from "@eo/contracts";
import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";
import { containsSecretShapedContent } from "../security/secret-patterns.js";

/**
 * Attachment streaming-validation pipeline — roadmap/18 §In scope:
 * "attachments (streamed, size/MIME/filename/malware/secret-checked;
 * bytes never enter prompts)." Work item 5, entry point: "a poisoned
 * fixture (oversized, spoofed MIME, embedded secret) that must be
 * rejected before any byte reaches a prompt."
 *
 * Every check here runs BEFORE `../attachments/attachment-staging.ts`
 * ever registers the file for upload — a rejected attachment never
 * reaches `../resource-client/comment-worklog-attachment-plans.ts`'s
 * `planAttachmentUpload`. `AttachmentValidationResult` deliberately
 * carries no content-bearing field on EITHER branch — the caller passes
 * bytes in, but only a redacted pass/fail verdict ever comes back out,
 * which is the actual mechanism behind "bytes never enter a prompt": the
 * only thing an LLM-facing tool call could ever see from this pipeline is
 * this bounded, content-free result shape.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB

export interface AttachmentCandidate {
  readonly filename: string;
  readonly claimedMimeType: string;
  readonly content: Buffer;
}

export type AttachmentValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly error: ConnectorError };

function reject(reason: string): AttachmentValidationResult {
  return {
    ok: false,
    reason,
    error: ConnectorError.validation({
      message: `attachment rejected: ${reason}`,
      provider: JIRA_PROVIDER_NAME,
      retryable: false,
    }),
  };
}

/**
 * Magic-byte signatures for MIME types this connector recognizes — a
 * claimed type whose declared bytes don't match is a spoofed-MIME
 * rejection. A `Map`, deliberately NOT a plain object literal — see
 * `../workflow/workflow-stage.ts`'s `KNOWN_STATUS_NAME_TO_STAGE` doc
 * comment for the same prototype-lookup pitfall this avoids: a caller-
 * supplied `claimedMimeType` of `"__proto__"`/`"constructor"`/etc.
 * against a plain object resolves to an inherited `Object.prototype`
 * member (not `undefined`), which `startsWithSignature` would then crash
 * on (`.every is not a function`) rather than treating gracefully as
 * simply unrecognized.
 */
const MIME_MAGIC_SIGNATURES: ReadonlyMap<string, readonly number[]> = new Map([
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["application/pdf", [0x25, 0x50, 0x44, 0x46]],
  ["application/zip", [0x50, 0x4b, 0x03, 0x04]],
]);

/** Magic-byte signatures this pipeline refuses outright regardless of claimed MIME type — executables have no legitimate attachment use case in this connector's scope. */
const DISALLOWED_EXECUTABLE_SIGNATURES: ReadonlyArray<readonly number[]> = [
  [0x4d, 0x5a], // Windows PE ("MZ")
  [0x7f, 0x45, 0x4c, 0x46], // ELF
];

function startsWithSignature(content: Buffer, signature: readonly number[]): boolean {
  if (content.length < signature.length) return false;
  return signature.every((byte, index) => content[index] === byte);
}

const EICAR_SUBSTRING = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

const PATH_TRAVERSAL_PATTERN = /(\.\.[/\\])|^[/\\]|:/;

/**
 * MEDIUM M2 (adversarial-review): a secret-shaped FILENAME (e.g. an AWS
 * access-key id pasted as a filename by mistake, or a hostile filename
 * crafted to smuggle secret-shaped text) was never scanned here, and the
 * filename is embedded verbatim into `../resource-client/comment-worklog-
 * attachment-plans.ts`'s `planAttachmentUpload` `redactedDiff` — which
 * 16 journals BEFORE any network I/O. A secret-shaped filename is
 * rejected at THIS boundary (before staging, before any plan is built),
 * so it can never reach that journal entry.
 */
function validateFilename(filename: string): string | undefined {
  if (filename.length === 0 || filename.length > 255) {
    return "filename length must be between 1 and 255 characters";
  }
  if (PATH_TRAVERSAL_PATTERN.test(filename)) {
    return "filename must not contain path-traversal or absolute-path characters";
  }
  if (containsSecretShapedContent(filename)) {
    return "filename contains secret-shaped content";
  }
  return undefined;
}

/**
 * MEDIUM M2 (adversarial-review) fix: the original EICAR check only
 * scanned the leading 4 KiB, while `MAX_ATTACHMENT_BYTES` allows up to
 * 10 MiB — a marker placed past that window passed clean. `content` is
 * already capped at `MAX_ATTACHMENT_BYTES` by the caller (the size check
 * runs first, in `validateAttachmentBeforeStaging`), so scanning the
 * FULL buffer here is itself bounded to that same 10-MiB ceiling — never
 * unbounded, but no longer silently blind to anything past an arbitrary
 * sub-window either.
 */
function validateMalwareSignatures(content: Buffer): string | undefined {
  for (const signature of DISALLOWED_EXECUTABLE_SIGNATURES) {
    if (startsWithSignature(content, signature)) {
      return "malware/executable signature detected";
    }
  }
  const full = content.toString("latin1");
  if (full.includes(EICAR_SUBSTRING)) {
    return "malware test signature (EICAR) detected";
  }
  return undefined;
}

function validateMimeSignature(claimedMimeType: string, content: Buffer): string | undefined {
  const expectedSignature = MIME_MAGIC_SIGNATURES.get(claimedMimeType);
  if (expectedSignature === undefined) {
    return undefined; // an unrecognized-but-not-dangerous claimed type is not itself a rejection reason
  }
  if (!startsWithSignature(content, expectedSignature)) {
    return `claimed MIME type "${claimedMimeType}" does not match the file's magic-byte signature`;
  }
  return undefined;
}

/**
 * MEDIUM M2 (adversarial-review) fix: scans the FULL (already
 * `MAX_ATTACHMENT_BYTES`-capped) content, never just a leading window —
 * the original 64 KiB window let a secret placed later in a ≤10 MiB file
 * pass clean. Never returns the matched text itself.
 */
function validateNoEmbeddedSecrets(content: Buffer): string | undefined {
  const full = content.toString("utf8");
  if (containsSecretShapedContent(full)) {
    return "embedded secret-shaped content detected";
  }
  return undefined;
}

/**
 * Runs every check, in order, cheapest/most-decisive first (size, then
 * filename, then magic-byte-based malware/MIME checks, then the bounded
 * secret scan) — the FIRST failing check short-circuits and rejects; this
 * pipeline never needs to report every violation at once (unlike 17's
 * `lint()`, which does, for a different reason: an author iterating on
 * copy benefits from seeing every finding, but an attachment is either
 * safe to stage or it isn't).
 */
export function validateAttachmentBeforeStaging(
  candidate: AttachmentCandidate,
): AttachmentValidationResult {
  if (candidate.content.byteLength > MAX_ATTACHMENT_BYTES) {
    return reject(
      `attachment size ${candidate.content.byteLength} bytes exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit`,
    );
  }

  const filenameError = validateFilename(candidate.filename);
  if (filenameError !== undefined) return reject(filenameError);

  const malwareError = validateMalwareSignatures(candidate.content);
  if (malwareError !== undefined) return reject(malwareError);

  const mimeError = validateMimeSignature(candidate.claimedMimeType, candidate.content);
  if (mimeError !== undefined) return reject(mimeError);

  const secretError = validateNoEmbeddedSecrets(candidate.content);
  if (secretError !== undefined) return reject(secretError);

  return { ok: true };
}
