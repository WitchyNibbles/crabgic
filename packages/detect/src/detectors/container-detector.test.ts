import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { containerDetector } from "./container-detector.js";

describe("containerDetector", () => {
  it("detects a Dockerfile", () => {
    const findings = containerDetector.detect(ctxFromFiles({ Dockerfile: "FROM node:24\n" }));
    expect(findings[0]).toMatchObject({ category: "container", ecosystem: "docker" });
  });

  it("detects a variant Dockerfile.prod and docker-compose.yml", () => {
    const findings = containerDetector.detect(
      ctxFromFiles({ "Dockerfile.prod": "", "docker-compose.yml": "" }),
    );
    expect(findings).toHaveLength(2);
  });

  it("returns an empty array with no container configuration", () => {
    expect(containerDetector.detect(ctxFromFiles({ "README.md": "" }))).toEqual([]);
  });
});
