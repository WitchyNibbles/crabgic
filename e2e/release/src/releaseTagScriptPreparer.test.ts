import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareTagScript } from "./releaseTagScriptPreparer.js";

describe("prepareTagScript — unit", () => {
  it("renders a tag-only script (no push) by default", () => {
    const script = prepareTagScript({ tagName: "v1.0.0", message: "Release v1.0.0" });
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("PREPARED, NOT EXECUTED");
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("git tag -a 'v1.0.0' -m 'Release v1.0.0' 'HEAD'");
    expect(script).not.toContain("git push");
  });

  it("includes a push line only when includePush is explicitly true", () => {
    const script = prepareTagScript({
      tagName: "v1.0.0",
      message: "Release v1.0.0",
      includePush: true,
    });
    expect(script).toContain("git push origin 'v1.0.0'");
  });

  it("honors an explicit commitIsh override instead of HEAD", () => {
    const sha = "a".repeat(40);
    const script = prepareTagScript({ tagName: "v1.0.0", message: "msg", commitIsh: sha });
    expect(script).toContain(`git tag -a 'v1.0.0' -m 'msg' '${sha}'`);
  });

  it("safely escapes a single quote embedded in the message", () => {
    const script = prepareTagScript({ tagName: "v1.0.0", message: "it's the real deal" });
    expect(script).toContain(`'it'\\''s the real deal'`);
  });

  it("ends with a restated human-initiated-step reminder", () => {
    const script = prepareTagScript({ tagName: "v1.0.0", message: "msg" });
    expect(script.trim().endsWith("Push it deliberately when ready.'")).toBe(true);
  });
});

describe("releaseTagScriptPreparer.ts — structural guarantee: never imports a process-execution module", () => {
  it("the source file itself has zero import statements — a purely textual renderer with no process/fs dependency at all", () => {
    const source = readFileSync(join(import.meta.dirname, "releaseTagScriptPreparer.ts"), "utf8");
    const codeOnly = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/^\s*import /m);
  });
});
