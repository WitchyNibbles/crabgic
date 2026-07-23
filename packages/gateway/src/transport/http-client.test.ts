import { describe, expect, it, vi } from "vitest";
import { GatewayHttpClient, SsrfRefusedError } from "./http-client.js";
import type { HttpTransportResponse } from "./http-transport.js";

const ALLOWLIST = {
  allowedSchemes: ["https:"],
  allowedOrigins: ["https://example.atlassian.net"],
};

function baseReq(overrides: Partial<Parameters<GatewayHttpClient["request"]>[0]> = {}) {
  return {
    connectionId: "conn-1",
    tenant: "tenant-a",
    resource: "issue:EX-1",
    url: new URL("https://example.atlassian.net/rest/api/3/issue/EX-1"),
    method: "GET" as const,
    ...overrides,
  };
}

describe("GatewayHttpClient — SSRF preflight", () => {
  it("refuses a foreign origin before any request is sent", async () => {
    const sendRequest = vi.fn();
    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    await expect(
      client.request(baseReq({ url: new URL("https://evil.example.com/steal") })),
    ).rejects.toBeInstanceOf(SsrfRefusedError);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("refuses when the allowlisted origin resolves to a private address (rebinding)", async () => {
    const sendRequest = vi.fn();
    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["127.0.0.1"],
    });

    await expect(client.request(baseReq())).rejects.toBeInstanceOf(SsrfRefusedError);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("allows an allowlisted origin resolving to a public address", async () => {
    const response: HttpTransportResponse = { status: 200, headers: {}, bodyText: "{}" };
    const sendRequest = vi.fn().mockResolvedValue(response);
    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    const result = await client.request(baseReq());
    expect(result.status).toBe(200);
    expect(sendRequest).toHaveBeenCalledOnce();
  });
});

describe("GatewayHttpClient — DNS pinning (HIGH #1 adversarial-review fix)", () => {
  it("dials the SAME resolved address that passed the SSRF check — never re-resolves at connect time", async () => {
    const sendRequest = vi.fn().mockImplementation(async (r: { pinnedAddress?: string }) => {
      expect(r.pinnedAddress).toBe("203.0.113.7");
      return { status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse;
    });
    const resolveHostAddresses = vi.fn().mockResolvedValue(["203.0.113.7"]);
    const client = new GatewayHttpClient({ allowlist: ALLOWLIST, sendRequest, resolveHostAddresses });

    await client.request(baseReq());
    expect(resolveHostAddresses).toHaveBeenCalledTimes(1); // resolved exactly once for this attempt/hop
    expect(sendRequest).toHaveBeenCalledOnce();
  });

  it("a rebinding resolver that answers a DIFFERENT (private) address on a later call never affects an in-flight request's already-pinned dial target", async () => {
    // Simulates a rebinding DNS server: the first lookup (used for THIS
    // request's own check-then-pin) returns a public address; any LATER
    // lookup (e.g. a naive re-resolution at connect time, or a second,
    // unrelated request) returns a private/metadata address instead. The
    // fix under test is that the pinned dial for THIS request never
    // performs that later lookup at all.
    const resolveHostAddresses = vi
      .fn()
      .mockResolvedValueOnce(["203.0.113.7"])
      .mockResolvedValueOnce(["169.254.169.254"]);
    const sendRequest = vi.fn().mockImplementation(async (r: { pinnedAddress?: string }) => {
      expect(r.pinnedAddress).toBe("203.0.113.7");
      return { status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse;
    });
    const client = new GatewayHttpClient({ allowlist: ALLOWLIST, sendRequest, resolveHostAddresses });

    const result = await client.request(baseReq());
    expect(result.status).toBe(200);
    expect(sendRequest).toHaveBeenCalledOnce();

    // Exactly one resolution happened for this request — the later,
    // rebound (private) answer was never even consulted, let alone used
    // to dial: proof there is no second, connect-time re-resolution for
    // this hop to be poisoned by.
    expect(resolveHostAddresses).toHaveBeenCalledTimes(1);
    expect(resolveHostAddresses.mock.results[1]).toBeUndefined();
  });

  it("pins each redirect hop to ITS OWN freshly-resolved address, never reusing the initial hop's pin", async () => {
    const resolveHostAddresses = vi
      .fn()
      .mockResolvedValueOnce(["203.0.113.7"]) // initial hop
      .mockResolvedValueOnce(["203.0.113.8"]); // redirect target hop
    const sendRequest = vi
      .fn()
      .mockImplementationOnce(async (r: { pinnedAddress?: string }) => {
        expect(r.pinnedAddress).toBe("203.0.113.7");
        return {
          status: 302,
          headers: { location: "https://example.atlassian.net/rest/api/3/issue/EX-2" },
          bodyText: "",
        } satisfies HttpTransportResponse;
      })
      .mockImplementationOnce(async (r: { pinnedAddress?: string }) => {
        expect(r.pinnedAddress).toBe("203.0.113.8");
        return { status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse;
      });
    const client = new GatewayHttpClient({ allowlist: ALLOWLIST, sendRequest, resolveHostAddresses });

    const result = await client.request(baseReq());
    expect(result.status).toBe(200);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });
});

describe("GatewayHttpClient — redirect revalidation", () => {
  it("follows a redirect to an allowlisted target after revalidating it", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: "https://example.atlassian.net/rest/api/3/issue/EX-2" },
        bodyText: "",
      } satisfies HttpTransportResponse)
      .mockResolvedValueOnce({ status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    const result = await client.request(baseReq());
    expect(result.status).toBe(200);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  it("refuses to follow a redirect to a foreign origin — never attaches credentials to it", async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce({
      status: 302,
      headers: { location: "https://evil.example.com/steal" },
      bodyText: "",
    } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    await expect(client.request(baseReq())).rejects.toBeInstanceOf(SsrfRefusedError);
    expect(sendRequest).toHaveBeenCalledTimes(1); // only the first hop; the redirect was never dialed
  });

  it("refuses to follow a redirect to a private-IP target", async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce({
      status: 302,
      headers: { location: "https://example.atlassian.net/rest/loop" },
      bodyText: "",
    } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: vi
        .fn()
        .mockResolvedValueOnce(["203.0.113.7"]) // first hop: allowed
        .mockResolvedValueOnce(["10.0.0.5"]), // redirect target resolves privately
    });

    await expect(client.request(baseReq())).rejects.toBeInstanceOf(SsrfRefusedError);
  });

  it("gives up after exceeding the max redirect hop count", async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      status: 302,
      headers: { location: "https://example.atlassian.net/rest/loop" },
      bodyText: "",
    } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    await expect(client.request(baseReq())).rejects.toThrow(/redirect hops/);
  });
});

describe("GatewayHttpClient — retry ladder + backoff", () => {
  it("retries a GET on a 503 and eventually succeeds", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, headers: {}, bodyText: "" } satisfies HttpTransportResponse)
      .mockResolvedValueOnce({ status: 200, headers: {}, bodyText: "ok" } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
      sleep: async () => undefined,
      random: () => 0,
    });

    const result = await client.request(baseReq());
    expect(result.status).toBe(200);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  it("does not blindly retry a POST on a 503", async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ status: 503, headers: {}, bodyText: "" } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
      sleep: async () => undefined,
    });

    const result = await client.request(baseReq({ method: "POST" }));
    expect(result.status).toBe(503);
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After between attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        headers: { "retry-after": "1" },
        bodyText: "",
      } satisfies HttpTransportResponse)
      .mockResolvedValueOnce({ status: 200, headers: {}, bodyText: "ok" } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
      sleep,
    });

    await client.request(baseReq());
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});

describe("GatewayHttpClient — budgets", () => {
  it("throws BudgetExceededError when the response body exceeds the result budget", async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      bodyText: "x".repeat(256 * 1024 + 1),
    } satisfies HttpTransportResponse);

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    await expect(client.request(baseReq())).rejects.toThrow(/budget/);
  });
});

describe("GatewayHttpClient — concurrency + write serialization", () => {
  it("preserves write order for the same tenant+resource under concurrent submission", async () => {
    const order: number[] = [];
    let counter = 0;
    const sendRequest = vi.fn().mockImplementation(async () => {
      const mine = counter;
      counter += 1;
      await new Promise((resolve) => setTimeout(resolve, mine === 0 ? 20 : 1));
      order.push(mine);
      return { status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse;
    });

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
    });

    await Promise.all([
      client.request(baseReq({ method: "PUT", isWrite: true, hasPrecondition: true })),
      client.request(baseReq({ method: "PUT", isWrite: true, hasPrecondition: true })),
    ]);

    expect(order).toEqual([0, 1]);
  });

  it("caps in-flight requests at maxInFlightPerConnection", async () => {
    let active = 0;
    let maxActive = 0;
    const sendRequest = vi.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: 200, headers: {}, bodyText: "{}" } satisfies HttpTransportResponse;
    });

    const client = new GatewayHttpClient({
      allowlist: ALLOWLIST,
      sendRequest,
      resolveHostAddresses: async () => ["203.0.113.7"],
      maxInFlightPerConnection: 2,
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        client.request(baseReq({ resource: `issue:EX-${i}` })),
      ),
    );

    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
