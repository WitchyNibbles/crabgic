import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideRetryAction, type HttpVerb } from "./retry-ladder.js";

const BASE = { attempt: 1, maxAttempts: 4 };

describe("decideRetryAction — verb-specific rules", () => {
  it("GET is free to retry on a 503", () => {
    const action = decideRetryAction({ ...BASE, verb: "GET", status: 503, hasPrecondition: false });
    expect(action.kind).toBe("retry");
  });

  it("PUT with a precondition retries deterministically", () => {
    const action = decideRetryAction({ ...BASE, verb: "PUT", status: 503, hasPrecondition: true });
    expect(action.kind).toBe("retry");
  });

  it("PUT without a precondition never blindly retries", () => {
    const action = decideRetryAction({ ...BASE, verb: "PUT", status: 503, hasPrecondition: false });
    expect(action.kind).toBe("give-up");
  });

  it("PATCH without a precondition never blindly retries", () => {
    const action = decideRetryAction({ ...BASE, verb: "PATCH", status: 503, hasPrecondition: false });
    expect(action.kind).toBe("give-up");
  });

  it("POST is never blindly retried, even with a precondition", () => {
    const action = decideRetryAction({ ...BASE, verb: "POST", status: 503, hasPrecondition: true });
    expect(action.kind).toBe("give-up");
  });

  it("DELETE without a precondition never blindly retries", () => {
    const action = decideRetryAction({ ...BASE, verb: "DELETE", status: 503, hasPrecondition: false });
    expect(action.kind).toBe("give-up");
  });
});

describe("decideRetryAction — 409/412 always fetch-rebase-or-block", () => {
  it.each(["GET", "PUT", "PATCH", "POST", "DELETE"] as const)(
    "status 409 on %s => fetch-rebase-or-block",
    (verb) => {
      const action = decideRetryAction({ ...BASE, verb, status: 409, hasPrecondition: true });
      expect(action.kind).toBe("fetch-rebase-or-block");
    },
  );

  it.each(["GET", "PUT", "PATCH", "POST", "DELETE"] as const)(
    "status 412 on %s => fetch-rebase-or-block",
    (verb) => {
      const action = decideRetryAction({ ...BASE, verb, status: 412, hasPrecondition: false });
      expect(action.kind).toBe("fetch-rebase-or-block");
    },
  );
});

describe("decideRetryAction — bounds", () => {
  it("gives up once max attempts are exhausted", () => {
    const action = decideRetryAction({
      verb: "GET",
      status: 503,
      hasPrecondition: false,
      attempt: 4,
      maxAttempts: 4,
    });
    expect(action.kind).toBe("give-up");
  });

  it("gives up on a success status", () => {
    const action = decideRetryAction({ ...BASE, verb: "GET", status: 200, hasPrecondition: false });
    expect(action.kind).toBe("give-up");
  });

  it("gives up on a non-retryable client error (404)", () => {
    const action = decideRetryAction({ ...BASE, verb: "GET", status: 404, hasPrecondition: false });
    expect(action.kind).toBe("give-up");
  });

  it("property: 409/412 always wins over verb/precondition/attempt combinations", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<HttpVerb>("GET", "PUT", "PATCH", "POST", "DELETE"),
        fc.boolean(),
        fc.integer({ min: 1, max: 10 }),
        fc.constantFrom(409, 412),
        (verb, hasPrecondition, attempt, status) => {
          const action = decideRetryAction({ verb, status, hasPrecondition, attempt, maxAttempts: 10 });
          expect(action.kind).toBe("fetch-rebase-or-block");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("property: POST is never a 'retry' verdict for any transient status/attempt", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(429, 500, 502, 503, 504),
        fc.integer({ min: 1, max: 9 }),
        fc.boolean(),
        (status, attempt, hasPrecondition) => {
          const action = decideRetryAction({
            verb: "POST",
            status,
            hasPrecondition,
            attempt,
            maxAttempts: 10,
          });
          expect(action.kind).not.toBe("retry");
        },
      ),
      { numRuns: 200 },
    );
  });
});
