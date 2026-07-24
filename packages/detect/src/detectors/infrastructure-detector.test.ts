import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { infrastructureDetector } from "./infrastructure-detector.js";

describe("infrastructureDetector", () => {
  it("detects a Terraform file", () => {
    const findings = infrastructureDetector.detect(
      ctxFromFiles({ "main.tf": 'resource "aws_s3_bucket" "x" {}\n' }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "terraform" });
  });

  it("detects a CloudFormation template", () => {
    const findings = infrastructureDetector.detect(
      ctxFromFiles({ "template.yaml": "AWSTemplateFormatVersion: '2010-09-09'\n" }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "cloudformation" });
  });

  it("detects a Kubernetes manifest", () => {
    const findings = infrastructureDetector.detect(
      ctxFromFiles({
        "deploy/service.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n",
      }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "kubernetes" });
  });

  it("never misclassifies a GitHub Actions workflow as a k8s manifest", () => {
    const findings = infrastructureDetector.detect(
      ctxFromFiles({ ".github/workflows/ci.yml": "apiVersion: not-really\nkind: also-not\n" }),
    );
    expect(findings).toEqual([]);
  });

  it("returns an empty array for a plain yaml file with no IaC shape", () => {
    expect(infrastructureDetector.detect(ctxFromFiles({ "config.yaml": "a: 1\n" }))).toEqual([]);
  });
});
