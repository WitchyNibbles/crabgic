import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DuplicateOperationError, SupervisorRouter, UnknownOperationError } from "./router.js";

const PingParams = z.object({ nonce: z.string() }).strict();
const PingResult = z.object({ echo: z.string() }).strict();

describe("SupervisorRouter", () => {
  it("dispatches a registered operation and returns its result", async () => {
    const router = new SupervisorRouter();
    router.register("test.ping", PingParams, PingResult, async (params) => ({
      echo: params.nonce,
    }));

    const result = await router.dispatch("test.ping", { nonce: "abc" });
    expect(result).toEqual({ echo: "abc" });
  });

  it("throws UnknownOperationError for an unregistered op", async () => {
    const router = new SupervisorRouter();
    await expect(router.dispatch("does.not.exist", {})).rejects.toBeInstanceOf(
      UnknownOperationError,
    );
  });

  it("throws DuplicateOperationError when the same op is registered twice", () => {
    const router = new SupervisorRouter();
    router.register("test.ping", PingParams, PingResult, async (p) => ({ echo: p.nonce }));
    expect(() =>
      router.register("test.ping", PingParams, PingResult, async (p) => ({ echo: p.nonce })),
    ).toThrow(DuplicateOperationError);
  });

  it("rejects invalid params before the handler ever runs", async () => {
    const router = new SupervisorRouter();
    let handlerCalled = false;
    router.register("test.ping", PingParams, PingResult, async (params) => {
      handlerCalled = true;
      return { echo: params.nonce };
    });

    await expect(router.dispatch("test.ping", { wrongField: 1 })).rejects.toThrow();
    expect(handlerCalled).toBe(false);
  });

  it("rejects a handler result that violates its own declared result schema", async () => {
    const router = new SupervisorRouter();
    router.register("test.badResult", PingParams, PingResult, async () => {
      return { notEcho: "oops" } as unknown as z.infer<typeof PingResult>;
    });
    await expect(router.dispatch("test.badResult", { nonce: "x" })).rejects.toThrow();
  });

  it("operationNames() lists every registered operation, sorted", () => {
    const router = new SupervisorRouter();
    router.register("b.op", PingParams, PingResult, async (p) => ({ echo: p.nonce }));
    router.register("a.op", PingParams, PingResult, async (p) => ({ echo: p.nonce }));
    expect(router.operationNames()).toEqual(["a.op", "b.op"]);
  });
});
