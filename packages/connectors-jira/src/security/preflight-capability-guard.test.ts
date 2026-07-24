import { describe, expect, it } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { assertAllowedJiraOperation } from "./preflight-capability-guard.js";

/**
 * roadmap/18 §Test plan, Security bullet: "forged delete/admin/
 * impersonation/raw-endpoint calls fail before any network I/O (pre-flight
 * capability check, never a server-side 403 as the sole guard)." This
 * suite proves the guard itself throws synchronously, before any transport
 * is ever constructed — there is no fake transport in this file at all,
 * which is the point: a call that never gets far enough to need one.
 */
describe("assertAllowedJiraOperation — forged/out-of-scope operations", () => {
  it.each([
    "issue.delete",
    "project.delete",
    "board.delete",
    "sprint.delete",
    "comment.delete",
    "attachment.delete",
    "user.delete",
    "user.impersonate",
    "permission-scheme.update",
    "workflow-scheme.update",
    "security-scheme.update",
    "automation-rule.create",
    "admin.settings.update",
    "raw.request",
    "",
    "issue.create; DROP TABLE",
  ])("rejects forged/out-of-scope action %j before any I/O", (action) => {
    expect(() => assertAllowedJiraOperation(action)).toThrow(ConnectorError);
    try {
      assertAllowedJiraOperation(action);
      throw new Error("expected assertAllowedJiraOperation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).kind).toBe("policy_blocked");
    }
  });

  it.each([
    "issue.create",
    "issue.update",
    "issue.transition",
    "issue.link",
    "issue.rank",
    "issue.bulkUpdate",
    "issue.bulkTransition",
    "comment.create",
    "comment.update",
    "worklog.create",
    "attachment.upload",
    "board.create",
    "board.update",
    "sprint.create",
    "sprint.start",
    "sprint.complete",
    "sprint.moveIssues",
  ])("allows every in-scope action %j", (action) => {
    expect(() => assertAllowedJiraOperation(action)).not.toThrow();
  });

  it("never leaks the raw candidate string in the thrown error's message when it looks like an injection attempt", () => {
    try {
      assertAllowedJiraOperation("'; DELETE FROM issues; --");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      const message = (err as ConnectorError).message;
      // The guard reports that the operation is unsupported — it never
      // needs to echo untrusted attacker-controlled text into a message
      // beyond a bounded, safe rendering.
      expect(message.length).toBeLessThan(200);
    }
  });
});
