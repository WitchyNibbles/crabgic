import { describe, expect, it } from "vitest";
import {
  COMMUNICATION_POLICY_LIMITS,
  CommunicationPolicySchema,
  DEFAULT_COMMUNICATION_POLICY,
  PROHIBITED_CONTENT_CATEGORIES,
  ProhibitedContentCategorySchema,
} from "./communication-policy.js";
import { checkLimit, countLines } from "../renderer-core/index.js";

/** Recursively collects every object key reachable from `value` (arrays included, harmlessly). */
function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      acc.push(key);
      collectKeys(nested, acc);
    }
  }
  return acc;
}

const GOLDEN_COMMUNICATION_POLICY = {
  schemaVersion: 1,
  limits: {
    branchName: { maxChars: 64 },
    commitSubject: { maxChars: 72, format: "type(scope): outcome" },
    commitBody: { maxLines: 5 },
    prTitle: { maxChars: 72, format: "type(scope): outcome" },
    prBody: { maxLines: 12, sections: ["Outcome", "Validation", "Risk", "Tracking"] },
    jiraSummary: { maxChars: 120 },
    jiraComment: {
      maxChars: 800,
      maxLines: 6,
      milestoneTemplate: ["Outcome", "Evidence", "Risk", "Next", "Ref"],
    },
    grafanaAnnotation: { maxChars: 240 },
    reviewComment: { maxLines: 6, shape: ["finding", "evidence", "action"] },
  },
  prohibitedContentCategories: [
    "attribution",
    "first_person",
    "signatures",
    "mentions",
    "secrets",
    "unsafe_links",
  ],
};

describe("PROHIBITED_CONTENT_CATEGORIES", () => {
  it("has exactly the 6 deliberately-spelled members", () => {
    expect(PROHIBITED_CONTENT_CATEGORIES).toEqual([
      "attribution",
      "first_person",
      "signatures",
      "mentions",
      "secrets",
      "unsafe_links",
    ]);
  });

  it("ProhibitedContentCategorySchema accepts every declared member", () => {
    for (const category of PROHIBITED_CONTENT_CATEGORIES) {
      expect(ProhibitedContentCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("ProhibitedContentCategorySchema rejects a label outside the closed union", () => {
    expect(ProhibitedContentCategorySchema.safeParse("dashboard_version").success).toBe(false);
  });
});

describe("COMMUNICATION_POLICY_LIMITS (roadmap/02 In-scope bullet, verbatim numbers)", () => {
  it("branch name <= 64 chars", () => {
    expect(COMMUNICATION_POLICY_LIMITS.branchName.maxChars).toBe(64);
  });

  it("commit subject <= 72 chars, `type(scope): outcome` format", () => {
    expect(COMMUNICATION_POLICY_LIMITS.commitSubject.maxChars).toBe(72);
    expect(COMMUNICATION_POLICY_LIMITS.commitSubject.format).toBe("type(scope): outcome");
  });

  it("commit body <= 5 lines", () => {
    expect(COMMUNICATION_POLICY_LIMITS.commitBody.maxLines).toBe(5);
  });

  it("PR title <= 72 chars, same convention as the commit subject", () => {
    expect(COMMUNICATION_POLICY_LIMITS.prTitle.maxChars).toBe(72);
    expect(COMMUNICATION_POLICY_LIMITS.prTitle.format).toBe("type(scope): outcome");
  });

  it("PR body <= 12 lines / 4 sections (Outcome, Validation, Risk, Tracking)", () => {
    expect(COMMUNICATION_POLICY_LIMITS.prBody.maxLines).toBe(12);
    expect(COMMUNICATION_POLICY_LIMITS.prBody.sections).toEqual([
      "Outcome",
      "Validation",
      "Risk",
      "Tracking",
    ]);
  });

  it("Jira summary <= 120 chars", () => {
    expect(COMMUNICATION_POLICY_LIMITS.jiraSummary.maxChars).toBe(120);
  });

  it("Jira comment <= 800 chars / 6 lines + milestone template", () => {
    expect(COMMUNICATION_POLICY_LIMITS.jiraComment.maxChars).toBe(800);
    expect(COMMUNICATION_POLICY_LIMITS.jiraComment.maxLines).toBe(6);
    expect(COMMUNICATION_POLICY_LIMITS.jiraComment.milestoneTemplate).toEqual([
      "Outcome",
      "Evidence",
      "Risk",
      "Next",
      "Ref",
    ]);
  });

  it("Grafana annotation <= 240 chars", () => {
    expect(COMMUNICATION_POLICY_LIMITS.grafanaAnnotation.maxChars).toBe(240);
  });

  it("review comment <= 6 lines (one finding, evidence, action) — exit criterion", () => {
    expect(COMMUNICATION_POLICY_LIMITS.reviewComment.maxLines).toBe(6);
    expect(COMMUNICATION_POLICY_LIMITS.reviewComment.shape).toEqual([
      "finding",
      "evidence",
      "action",
    ]);
  });

  it("contains no dashboard-version-message entry anywhere (ledger Gap 6; exit criterion)", () => {
    for (const key of collectKeys(COMMUNICATION_POLICY_LIMITS)) {
      expect(key).not.toMatch(/dashboard/i);
    }
  });
});

describe("CommunicationPolicySchema / DEFAULT_COMMUNICATION_POLICY", () => {
  it("DEFAULT_COMMUNICATION_POLICY parses against its own schema", () => {
    expect(CommunicationPolicySchema.safeParse(DEFAULT_COMMUNICATION_POLICY).success).toBe(true);
  });

  it("matches the golden CommunicationPolicy snapshot (roadmap/02 exit criterion)", () => {
    expect(DEFAULT_COMMUNICATION_POLICY).toEqual(GOLDEN_COMMUNICATION_POLICY);
  });

  it("golden snapshot includes the review-comment limit", () => {
    expect(DEFAULT_COMMUNICATION_POLICY.limits.reviewComment.maxLines).toBe(6);
  });

  it("golden snapshot contains no dashboard-version-message entry anywhere (exit criterion, literal wording)", () => {
    for (const key of collectKeys(DEFAULT_COMMUNICATION_POLICY)) {
      expect(key).not.toMatch(/dashboard/i);
    }
  });

  it("rejects an unknown top-level field (.strict())", () => {
    const invalid = { ...DEFAULT_COMMUNICATION_POLICY, extra: true };
    expect(CommunicationPolicySchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { schemaVersion: _schemaVersion, ...rest } = DEFAULT_COMMUNICATION_POLICY;
    expect(CommunicationPolicySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a prohibited-content category outside the closed union", () => {
    const invalid = {
      ...DEFAULT_COMMUNICATION_POLICY,
      prohibitedContentCategories: ["dashboard_version"],
    };
    expect(CommunicationPolicySchema.safeParse(invalid).success).toBe(false);
  });

  it("round-trips through JSON serialize/parse", () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(DEFAULT_COMMUNICATION_POLICY));
    const reparsed = CommunicationPolicySchema.parse(roundTripped);
    expect(reparsed).toEqual(DEFAULT_COMMUNICATION_POLICY);
  });
});

describe("Work item 6 failing-first fixture — over-length review comment", () => {
  const sixLineReviewComment = [
    "Finding: off-by-one in pagination cursor advance.",
    "Evidence: unit test tests/pagination.spec.ts:42 reproduces the skip.",
    "Action: clamp the cursor to the last valid page before advancing.",
    "Additional detail line four.",
    "Additional detail line five.",
    "Additional detail line six.",
  ].join("\n");

  const sevenLineReviewComment = `${sixLineReviewComment}\nAdditional detail line seven.`;

  it("accepts a review comment at exactly the 6-line limit", () => {
    expect(countLines(sixLineReviewComment)).toBe(6);
    expect(
      checkLimit(sixLineReviewComment, DEFAULT_COMMUNICATION_POLICY.limits.reviewComment),
    ).toBe(true);
  });

  it("rejects a 7-line review comment as over-length (the mandated failing-first fixture)", () => {
    expect(countLines(sevenLineReviewComment)).toBe(7);
    expect(
      checkLimit(sevenLineReviewComment, DEFAULT_COMMUNICATION_POLICY.limits.reviewComment),
    ).toBe(false);
  });
});
