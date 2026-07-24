import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { observabilityDetector } from "./observability-detector.js";

describe("observabilityDetector", () => {
  it("detects an OpenTelemetry dependency in package.json", () => {
    const findings = observabilityDetector.detect(
      ctxFromFiles({
        "package.json": JSON.stringify({ dependencies: { "@opentelemetry/api": "^1.0.0" } }),
      }),
    );
    expect(findings[0]).toMatchObject({ detail: "observability dependency: @opentelemetry/api" });
  });

  it("detects a Sentry dependency in devDependencies", () => {
    const findings = observabilityDetector.detect(
      ctxFromFiles({
        "package.json": JSON.stringify({ devDependencies: { "@sentry/node": "^8.0.0" } }),
      }),
    );
    expect(findings[0]).toMatchObject({ detail: "observability dependency: @sentry/node" });
  });

  it("detects an otel-collector-config.yaml file", () => {
    const findings = observabilityDetector.detect(
      ctxFromFiles({ "otel-collector-config.yaml": "" }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "generic" });
  });

  it("returns an empty array with no observability signal", () => {
    expect(
      observabilityDetector.detect(ctxFromFiles({ "package.json": JSON.stringify({}) })),
    ).toEqual([]);
  });
});
