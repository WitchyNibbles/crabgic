import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { languageRuntimeDetector } from "./language-runtime-detector.js";

describe("languageRuntimeDetector", () => {
  it("detects engines.node from a package.json", () => {
    const findings = languageRuntimeDetector.detect(
      ctxFromFiles({ "package.json": JSON.stringify({ engines: { node: ">=24" } }) }),
    );
    expect(findings).toEqual([
      {
        category: "language_runtime",
        ecosystem: "node",
        detail: "engines.node: >=24",
        path: "package.json",
        confidence: 0.9,
      },
    ]);
  });

  it("detects requires-python from pyproject.toml", () => {
    const findings = languageRuntimeDetector.detect(
      ctxFromFiles({ "pyproject.toml": 'requires-python = ">=3.12"\n' }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "python", detail: "requires-python: >=3.12" });
  });

  it("detects the go directive from go.mod", () => {
    const findings = languageRuntimeDetector.detect(
      ctxFromFiles({ "go.mod": "module example.com/x\n\ngo 1.23\n" }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "go", detail: "go directive: 1.23" });
  });

  it("detects edition from Cargo.toml", () => {
    const findings = languageRuntimeDetector.detect(
      ctxFromFiles({ "Cargo.toml": '[package]\nname = "x"\nedition = "2021"\n' }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "rust", detail: "edition: 2021" });
  });

  it("finds one node engines finding per monorepo package (raw material for contradiction detection)", () => {
    const findings = languageRuntimeDetector.detect(
      ctxFromFiles({
        "packages/a/package.json": JSON.stringify({ engines: { node: ">=20" } }),
        "packages/b/package.json": JSON.stringify({ engines: { node: ">=24" } }),
      }),
    );
    expect(findings).toHaveLength(2);
  });

  it("skips a malformed package.json rather than throwing", () => {
    expect(() =>
      languageRuntimeDetector.detect(ctxFromFiles({ "package.json": "{not json" })),
    ).not.toThrow();
    expect(languageRuntimeDetector.detect(ctxFromFiles({ "package.json": "{not json" }))).toEqual(
      [],
    );
  });

  it("returns an empty array when no manifest declares a runtime version", () => {
    expect(languageRuntimeDetector.detect(ctxFromFiles({ "package.json": "{}" }))).toEqual([]);
  });
});
