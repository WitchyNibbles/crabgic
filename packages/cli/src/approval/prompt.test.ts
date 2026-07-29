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

  // The `crabgic run < intake.json` shape: an earlier reader (the intake JSON
  // parse) consumed stdin to EOF, so `end` has ALREADY been emitted by the
  // time the prompt attaches its listeners — no event will ever fire for
  // them. The flow must decline, not hang with the prompt on screen.
  it(
    "declines immediately on a stream that already ended before the prompt attached",
    { timeout: 2000 },
    async () => {
      const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
      const input = new PassThrough();
      input.end();
      // Drain it exactly the way `readIntakeRequestFromStdin` does, so
      // `readableEnded` is true and `end` has genuinely already fired.
      for await (const _chunk of input) {
        void _chunk;
      }
      expect(input.readableEnded).toBe(true);

      const output = new PassThrough();
      const flow = runApprovalFlow(minter, "envelope_hash", "digest-eof", { input, output });
      await expect(flow).rejects.toThrow(ApprovalDeclinedError);
    },
  );

  it(
    "declines when the stream ends after the prompt with no input (EOF is not consent)",
    { timeout: 2000 },
    async () => {
      const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
      const input = new PassThrough();
      const output = new PassThrough();

      const flow = runApprovalFlow(minter, "envelope_hash", "digest-eof-2", { input, output });
      input.end();
      await expect(flow).rejects.toThrow(ApprovalDeclinedError);
    },
  );

  it(
    "treats EOF as terminating the final line: 'yes' then end-of-input mints",
    { timeout: 2000 },
    async () => {
      const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
      const input = new PassThrough();
      const output = new PassThrough();

      const flow = runApprovalFlow(minter, "envelope_hash", "digest-eof-3", { input, output });
      input.end("yes");
      const minted = await flow;
      expect(minted.digest).toBe("digest-eof-3");
    },
  );

  // An abnormal teardown is not an answer: a buffered "yes" the human never
  // submitted must not mint (adversarial review, 2026-07-29).
  it(
    "declines when the stream is destroyed with an unsubmitted 'yes' buffered",
    { timeout: 2000 },
    async () => {
      const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
      const input = new PassThrough();
      const output = new PassThrough();

      const flow = runApprovalFlow(minter, "envelope_hash", "digest-unsubmitted", {
        input,
        output,
      });
      input.write("yes");
      await new Promise((resolve) => setImmediate(resolve));
      input.destroy();
      await expect(flow).rejects.toThrow(ApprovalDeclinedError);
    },
  );

  it(
    "declines (never crashes, never mints) when the input stream errors",
    { timeout: 2000 },
    async () => {
      const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
      const input = new PassThrough();
      const output = new PassThrough();

      const flow = runApprovalFlow(minter, "envelope_hash", "digest-err", { input, output });
      input.destroy(new Error("tty went away"));
      await expect(flow).rejects.toThrow(ApprovalDeclinedError);
    },
  );

  it("removes every listener it attached once the flow settles", async () => {
    const minter = new ApprovalTokenMinter({ secretKey: randomBytes(32) });
    const input = new PassThrough();
    const output = new PassThrough();

    const flow = runApprovalFlow(minter, "envelope_hash", "digest-clean", { input, output });
    input.write("yes\n");
    await flow;

    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
  });
});
