import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { ciDetector } from "./ci-detector.js";

describe("ciDetector", () => {
  it("detects a GitHub Actions workflow", () => {
    const findings = ciDetector.detect(ctxFromFiles({ ".github/workflows/ci.yml": "name: ci\n" }));
    expect(findings[0]).toMatchObject({
      category: "ci",
      ecosystem: "github-actions",
      path: ".github/workflows/ci.yml",
    });
  });

  it("detects GitLab CI, CircleCI, and Jenkins configs", () => {
    const findings = ciDetector.detect(
      ctxFromFiles({ ".gitlab-ci.yml": "", ".circleci/config.yml": "", Jenkinsfile: "" }),
    );
    expect(findings.map((f) => f.ecosystem).sort()).toEqual(["circleci", "gitlab-ci", "jenkins"]);
  });

  it("returns an empty array with no CI configuration present", () => {
    expect(ciDetector.detect(ctxFromFiles({ "README.md": "" }))).toEqual([]);
  });
});
