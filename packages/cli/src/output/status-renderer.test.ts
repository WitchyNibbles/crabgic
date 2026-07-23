import { describe, expect, it } from "vitest";
import { renderStatusEvent, renderWorkUnitStatusLine } from "./status-renderer.js";

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

describe("renderStatusEvent", () => {
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
