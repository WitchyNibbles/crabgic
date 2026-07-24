import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { MAX_ATTACHMENT_BYTES, validateAttachmentBeforeStaging } from "./attachment-pipeline.js";

/**
 * roadmap/18 work item 5 entry point: "failing test with a poisoned
 * fixture (oversized, spoofed MIME, embedded secret) that must be
 * rejected before any byte reaches a prompt." §Test plan, Security bullet:
 * "attachment pipeline rejects oversized/spoofed-MIME/embedded-secret
 * fixtures before bytes reach a prompt."
 *
 * `validateAttachmentBeforeStaging` returns only a pass/fail verdict plus
 * a redacted reason — it NEVER returns the file's bytes/content to the
 * caller, which is how this suite proves "bytes never enter a prompt":
 * the return type itself has no content-carrying field.
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("validateAttachmentBeforeStaging", () => {
  it("accepts a small, correctly-typed, clean file", () => {
    const content = Buffer.concat([PNG_MAGIC, Buffer.from("rest-of-png-bytes")]);
    const result = validateAttachmentBeforeStaging({
      filename: "screenshot.png",
      claimedMimeType: "image/png",
      content,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an oversized attachment before any byte is otherwise inspected", () => {
    const content = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x41);
    const result = validateAttachmentBeforeStaging({
      filename: "huge.bin",
      claimedMimeType: "application/octet-stream",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConnectorError);
      expect(result.reason).toMatch(/size/i);
    }
  });

  it("rejects a spoofed MIME type — claimed image/png but the magic bytes don't match", () => {
    const content = Buffer.from("this is definitely not a PNG file, just plain text");
    const result = validateAttachmentBeforeStaging({
      filename: "fake.png",
      claimedMimeType: "image/png",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/mime|signature/i);
  });

  it("rejects a filename with path-traversal characters", () => {
    const content = Buffer.concat([PNG_MAGIC, Buffer.from("x")]);
    const result = validateAttachmentBeforeStaging({
      filename: "../../etc/passwd.png",
      claimedMimeType: "image/png",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/filename/i);
  });

  it("rejects a Windows executable disguised with a benign extension", () => {
    const content = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.from("rest-of-exe")]);
    const result = validateAttachmentBeforeStaging({
      filename: "report.pdf",
      claimedMimeType: "application/pdf",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/malware|executable|signature/i);
  });

  it("rejects the EICAR anti-malware test string", () => {
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    const result = validateAttachmentBeforeStaging({
      filename: "clean.txt",
      claimedMimeType: "text/plain",
      content: eicar,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/malware/i);
  });

  it("rejects a file whose text region embeds an AWS-shaped secret key", () => {
    const content = Buffer.from(
      "config:\naws_access_key_id = AKIAABCDEFGHIJKLMNOP\naws_secret_access_key=abc\n",
    );
    const result = validateAttachmentBeforeStaging({
      filename: "config.txt",
      claimedMimeType: "text/plain",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/secret/i);
  });

  it("rejects a file embedding a PEM private key header", () => {
    const content = Buffer.from(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIExyz\n-----END RSA PRIVATE KEY-----\n",
    );
    const result = validateAttachmentBeforeStaging({
      filename: "id_rsa.txt",
      claimedMimeType: "text/plain",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/secret/i);
  });

  it("never surfaces the raw content in a rejected result's fields", () => {
    const secretPayload = "AKIAABCDEFGHIJKLMNOP super-secret-do-not-leak";
    const content = Buffer.from(secretPayload);
    const result = validateAttachmentBeforeStaging({
      filename: "config.txt",
      claimedMimeType: "text/plain",
      content,
    });
    expect(JSON.stringify(result)).not.toContain(secretPayload);
  });

  // MEDIUM M2 (adversarial-review): the scan windows were bounded (64 KiB
  // for secrets, 4 KiB for EICAR) while MAX_ATTACHMENT_BYTES allows up to
  // 10 MiB — a secret or EICAR marker placed past those windows passed
  // clean. The fix scans the FULL (already 10-MiB-capped) content.
  it("rejects a secret placed well past the old 64 KiB scan window", () => {
    const padding = Buffer.alloc(100_000, 0x41); // 100 KB of 'A' padding
    const content = Buffer.concat([padding, Buffer.from("AKIAABCDEFGHIJKLMNOP")]);
    const result = validateAttachmentBeforeStaging({
      filename: "padded.txt",
      claimedMimeType: "text/plain",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/secret/i);
  });

  it("rejects an EICAR signature placed well past the old 4 KiB scan window", () => {
    const padding = Buffer.alloc(50_000, 0x42); // 50 KB of 'B' padding
    const content = Buffer.concat([padding, Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")]);
    const result = validateAttachmentBeforeStaging({
      filename: "padded-eicar.txt",
      claimedMimeType: "text/plain",
      content,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/malware/i);
  });

  it("rejects a secret-shaped filename, before any redactedDiff embedding can occur", () => {
    const result = validateAttachmentBeforeStaging({
      filename: "AKIAABCDEFGHIJKLMNOP-notes.txt",
      claimedMimeType: "text/plain",
      content: Buffer.from("harmless content"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/filename/i);
  });

  // Same prototype-lookup class of bug as workflow-stage.ts's
  // KNOWN_STATUS_NAME_TO_STAGE (found via M3 property-test broadening):
  // a plain-object MIME-signature lookup indexed by a caller-supplied
  // `claimedMimeType` string is vulnerable to `"__proto__"`/`"constructor"`
  // resolving to an inherited `Object.prototype` member instead of
  // `undefined` — never a graceful "unrecognized type," a crash.
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "never crashes on the dangerous claimed MIME type %j — treated as simply unrecognized",
    (dangerousMimeType) => {
      const result = validateAttachmentBeforeStaging({
        filename: "file.bin",
        claimedMimeType: dangerousMimeType,
        content: Buffer.from("arbitrary content, no signature to match"),
      });
      expect(result.ok).toBe(true);
    },
  );
});
