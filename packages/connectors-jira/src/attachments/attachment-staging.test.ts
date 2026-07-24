import { describe, expect, it } from "vitest";
import { AttachmentStagingRegistry, AttachmentStagingNotFoundError } from "./attachment-staging.js";

describe("AttachmentStagingRegistry", () => {
  it("stages a validated attachment and returns a stagingId, later resolvable exactly once", () => {
    const registry = new AttachmentStagingRegistry();
    const content = Buffer.from("hello");

    const stagingId = registry.stage({ filename: "a.txt", mimeType: "text/plain", content });
    const resolved = registry.take(stagingId);

    expect(resolved.filename).toBe("a.txt");
    expect(resolved.content).toEqual(content);
  });

  it("consumes the staged entry — a second take() throws", () => {
    const registry = new AttachmentStagingRegistry();
    const stagingId = registry.stage({
      filename: "a.txt",
      mimeType: "text/plain",
      content: Buffer.from("x"),
    });

    registry.take(stagingId);

    expect(() => registry.take(stagingId)).toThrow(AttachmentStagingNotFoundError);
  });

  it("throws for an unknown stagingId", () => {
    const registry = new AttachmentStagingRegistry();
    expect(() => registry.take("never-staged")).toThrow(AttachmentStagingNotFoundError);
  });

  it("generates unique staging ids across multiple stage() calls", () => {
    const registry = new AttachmentStagingRegistry();
    const a = registry.stage({ filename: "a", mimeType: "text/plain", content: Buffer.from("a") });
    const b = registry.stage({ filename: "b", mimeType: "text/plain", content: Buffer.from("b") });
    expect(a).not.toBe(b);
  });
});
