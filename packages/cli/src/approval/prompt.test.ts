import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ApprovalTokenMinter } from "./token.js";
import { ApprovalDeclinedError, renderApprovalPrompt, runApprovalFlow } from "./prompt.js";

describe("renderApprovalPrompt", () => {
  it("renders the arbitrary digest verbatim", () => {
    const rendered = renderApprovalPrompt("envelope_hash", "abc123digest");
    expect(rendered).toContain("abc123digest");
    expect(rendered).toContain("authorization envelope");
  });

  it("labels a capability_digest subject distinctly", () => {
    expect(renderApprovalPrompt("capability_digest", "cap-digest")).toContain(
      "capability manifest",
    );
  });

  it("labels a learning_review subject distinctly (roadmap/22's independent-review token)", () => {
    expect(renderApprovalPrompt("learning_review", "learning-digest")).toContain(
      "learning proposal (independent review)",
    );
  });
});

describe("runApprovalFlow", () => {
  it("mints a token only after an explicit 'yes' confirmation", async () => {
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const input = new PassThrough();
    const output = new PassThrough();
    const outputChunks: string[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk.toString("utf8")));

    const flow = runApprovalFlow(minter, "envelope_hash", "digest-x", { input, output });
    input.write("yes\n");
    const minted = await flow;

    expect(minted.subjectKind).toBe("envelope_hash");
    expect(minted.digest).toBe("digest-x");
    expect(outputChunks.join("")).toContain("digest-x");
  });

  it("declines and never mints for anything other than 'yes'", async () => {
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const input = new PassThrough();
    const output = new PassThrough();

    const flow = runApprovalFlow(minter, "envelope_hash", "digest-y", { input, output });
    input.write("no\n");
    await expect(flow).rejects.toThrow(ApprovalDeclinedError);
  });

  it("declines on a stray non-'yes' response even if it contains the word yes elsewhere", async () => {
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const input = new PassThrough();
    const output = new PassThrough();

    const flow = runApprovalFlow(minter, "capability_digest", "digest-z", { input, output });
    input.write("yes please\n");
    await expect(flow).rejects.toThrow(ApprovalDeclinedError);
  });
});
