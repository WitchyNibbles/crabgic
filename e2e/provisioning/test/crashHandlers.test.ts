import { afterEach, describe, expect, it, vi } from "vitest";

import { registerCrashHandlers } from "../src/crashHandlers.js";

describe("registerCrashHandlers", () => {
  const registrations: Array<{ unregister: () => void }> = [];

  afterEach(() => {
    for (const r of registrations.splice(0)) {
      r.unregister();
    }
  });

  it("invokes cleanup exactly once when a trapped signal fires", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit, signals: ["SIGUSR2"] });
    registrations.push(handlers);

    process.emit("SIGUSR2");
    // Wait on `exit` (the last step of the chain), not `cleanup` (the
    // first): `cleanup` is recorded as "called" the instant it's invoked,
    // synchronously, before its own returned promise — let alone the
    // `.then(() => exit(...))` continuation after it — has settled.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(handlers.triggeredBy()).toBe("signal:SIGUSR2");
  });

  it("only ever calls cleanup once even if two trapped signals fire", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit, signals: ["SIGUSR2", "SIGWINCH"] });
    registrations.push(handlers);

    process.emit("SIGUSR2");
    process.emit("SIGWINCH");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("invokes cleanup on uncaughtException", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit, signals: [] });
    registrations.push(handlers);

    process.emit("uncaughtException", new Error("boom"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(handlers.triggeredBy()).toBe("uncaughtException");
  });

  it("invokes cleanup on unhandledRejection", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit, signals: [] });
    registrations.push(handlers);

    process.emit("unhandledRejection", new Error("nope"), Promise.resolve());
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(handlers.triggeredBy()).toBe("unhandledRejection");
  });

  it("still exits even when cleanup itself rejects", async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit, signals: ["SIGUSR2"] });
    registrations.push(handlers);

    process.emit("SIGUSR2");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("unregister() removes listeners so a later signal no longer triggers cleanup", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit, signals: ["SIGUSR2"] });

    handlers.unregister();
    process.emit("SIGUSR2");

    // Give any (wrongly-still-registered) handler a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("defaults to trapping SIGINT and SIGTERM when no signals option is given", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handlers = registerCrashHandlers(cleanup, { exit });
    registrations.push(handlers);

    process.emit("SIGINT");
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  it("triggeredBy() is undefined before anything has fired", () => {
    const handlers = registerCrashHandlers(vi.fn().mockResolvedValue(undefined), {
      exit: vi.fn(),
      signals: [],
    });
    registrations.push(handlers);
    expect(handlers.triggeredBy()).toBeUndefined();
  });
});
