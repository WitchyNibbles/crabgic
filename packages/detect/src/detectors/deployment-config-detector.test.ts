import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { deploymentConfigDetector } from "./deployment-config-detector.js";

describe("deploymentConfigDetector", () => {
  it("detects a Procfile as heroku", () => {
    const findings = deploymentConfigDetector.detect(ctxFromFiles({ Procfile: "web: node x.js" }));
    expect(findings[0]).toMatchObject({ ecosystem: "heroku" });
  });

  it("detects vercel.json and netlify.toml", () => {
    const findings = deploymentConfigDetector.detect(
      ctxFromFiles({ "vercel.json": "{}", "netlify.toml": "" }),
    );
    expect(findings.map((f) => f.ecosystem).sort()).toEqual(["netlify", "vercel"]);
  });

  it("returns an empty array with no deployment configuration", () => {
    expect(deploymentConfigDetector.detect(ctxFromFiles({ "README.md": "" }))).toEqual([]);
  });
});
