import { describe, expect, it } from "vitest";
import {
  ROLE_COLORS,
  WORK_UNIT_ATTEMPT_STATUSES,
  paint,
  stripAnsi,
  type PresentationContext,
  type PresentationProfile,
} from "@crabgic/contracts";
import { renderStatusEvent, renderWorkUnitStatusLine } from "./status-renderer.js";

const plain = (profile: PresentationProfile): PresentationContext => ({ profile, color: false });
const lit = (profile: PresentationProfile): PresentationContext => ({ profile, color: true });

describe("renderWorkUnitStatusLine", () => {
  it("renders a scripted parked:rate_limit event distinctly from running/failed", () => {
    const parked = renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "parked:rate_limit" });
    const running = renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "dispatched" });
    const failed = renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "failed" });

    expect(parked).not.toBe(running);
    expect(parked).not.toBe(failed);
    expect(parked).toContain("parked (rate limit)");
    expect(running).toContain("running");
    expect(failed).toContain("failed");
  });

  it("renders every WorkUnitAttemptStatus member distinctly", () => {
    const lines = (
      ["pending", "dispatched", "succeeded", "failed", "cancelled", "parked:rate_limit"] as const
    ).map((status) => renderWorkUnitStatusLine({ workUnitId: "wu-1", status }));
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe("renderWorkUnitStatusLine — presentation profiles", () => {
  it("defaults to the text profile, so piped and snapshot-captured output is unchanged by this feature", () => {
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "succeeded" })).toBe(
      "✓ [wu-1] succeeded",
    );
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "failed" })).toBe(
      "✗ [wu-1] failed",
    );
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "parked:rate_limit" })).toBe(
      "⏸ [wu-1] parked (rate limit)",
    );
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "dispatched" })).toBe(
      "• [wu-1] running",
    );
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "pending" })).toBe(
      "• [wu-1] pending",
    );
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "cancelled" })).toBe(
      "• [wu-1] cancelled",
    );
  });

  it("signposts with emoji when the caller resolved an interactive terminal", () => {
    expect(
      renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "succeeded" }, plain("emoji")),
    ).toBe("✅ [wu-1] succeeded");
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "failed" }, plain("emoji"))).toBe(
      "❌ [wu-1] failed",
    );
    expect(
      renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "parked:rate_limit" }, plain("emoji")),
    ).toBe("⏸️ [wu-1] parked (rate limit)");
  });

  it("separates running from pending in the emoji profile, which the text profile collapses", () => {
    const running = renderWorkUnitStatusLine(
      { workUnitId: "wu-1", status: "dispatched" },
      plain("emoji"),
    );
    const pending = renderWorkUnitStatusLine(
      { workUnitId: "wu-1", status: "pending" },
      plain("emoji"),
    );
    expect(running.slice(0, 2)).not.toBe(pending.slice(0, 2));
  });

  it("colours each line by verdict once the caller resolved an interactive terminal", () => {
    expect(renderWorkUnitStatusLine({ workUnitId: "wu-1", status: "failed" }, lit("emoji"))).toBe(
      paint(ROLE_COLORS.fail, "❌ [wu-1] failed", true),
    );
  });

  it("adds colour without changing a byte of the text — strips back to the monochrome render", () => {
    for (const status of WORK_UNIT_ATTEMPT_STATUSES) {
      expect(stripAnsi(renderWorkUnitStatusLine({ workUnitId: "w", status }, lit("emoji")))).toBe(
        renderWorkUnitStatusLine({ workUnitId: "w", status }, plain("emoji")),
      );
    }
  });

  it("stays 7-bit in the ascii profile", () => {
    for (const status of WORK_UNIT_ATTEMPT_STATUSES) {
      const marker = renderWorkUnitStatusLine({ workUnitId: "w", status }, plain("ascii")).split(
        " ",
      )[0];

      expect(marker, status).toMatch(/^[\x21-\x7e]+$/);
    }
  });
});

describe("renderStatusEvent", () => {
  it("threads the profile through to the status line", () => {
    expect(
      renderStatusEvent(
        { event: "work_unit.status", payload: { workUnitId: "wu-2", status: "succeeded" } },
        plain("emoji"),
      ),
    ).toBe("✅ [wu-2] succeeded");
  });

  it("renders a recognizable {workUnitId, status} payload as a status line", () => {
    const rendered = renderStatusEvent({
      event: "work_unit.status",
      payload: { workUnitId: "wu-2", status: "parked:rate_limit" },
    });
    expect(rendered).toContain("parked (rate limit)");
  });

  it("degrades gracefully to a generic line for an unrecognized event shape", () => {
    const rendered = renderStatusEvent({ event: "worker.log", payload: { line: "hello" } });
    expect(rendered).toContain("worker.log");
    expect(rendered).toContain("hello");
  });

  it("degrades gracefully when status is present but not a known WorkUnitAttemptStatus", () => {
    const rendered = renderStatusEvent({
      event: "bogus",
      payload: { workUnitId: "wu-3", status: "not-a-real-status" },
    });
    expect(rendered).toContain("[event] bogus");
  });
});
