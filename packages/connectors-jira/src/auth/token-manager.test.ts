import { describe, expect, it, vi } from "vitest";
import { ConnectorError } from "@eo/contracts";
import { JiraTokenManager } from "./token-manager.js";

/**
 * roadmap/18 work item 1 entry point: "failing unit test — an expired/
 * not-yet-refreshed token must be rejected before any resource call
 * fires." roadmap/18 §Test plan, Unit bullet: "OAuth token-manager
 * refresh/expiry/clock-skew edge cases."
 */
describe("JiraTokenManager — fetch and cache", () => {
  it("fetches a token on first use and caches it for subsequent calls", async () => {
    const fetchToken = vi.fn().mockResolvedValue({
      accessToken: "token-1",
      expiresInSeconds: 3600,
      scopes: ["read:jira-work", "write:jira-work"],
    });
    const manager = new JiraTokenManager({
      fetchToken,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const first = await manager.getAccessToken();
    const second = await manager.getAccessToken();

    expect(first.accessToken).toBe("token-1");
    expect(second.accessToken).toBe("token-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cached token has expired", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token-1", expiresInSeconds: 60, scopes: [] })
      .mockResolvedValueOnce({ accessToken: "token-2", expiresInSeconds: 60, scopes: [] });
    const manager = new JiraTokenManager({ fetchToken, clock: () => now });

    const first = await manager.getAccessToken();
    now = new Date(now.getTime() + 61_000);
    const second = await manager.getAccessToken();

    expect(first.accessToken).toBe("token-1");
    expect(second.accessToken).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("honors a clock-skew safety buffer — refreshes BEFORE the token's literal expiry instant", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token-1", expiresInSeconds: 60, scopes: [] })
      .mockResolvedValueOnce({ accessToken: "token-2", expiresInSeconds: 60, scopes: [] });
    const manager = new JiraTokenManager({
      fetchToken,
      clock: () => now,
      clockSkewBufferSeconds: 30,
    });

    await manager.getAccessToken();
    // 45s later: not yet literally expired (60s), but inside the 30s buffer.
    now = new Date(now.getTime() + 45_000);
    const second = await manager.getAccessToken();

    expect(second.accessToken).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("rejects — never returns a token — when the fetch fails, and never caches a failure", async () => {
    const fetchToken = vi.fn().mockRejectedValue(new Error("network unreachable"));
    const manager = new JiraTokenManager({ fetchToken });

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(ConnectorError);
    await expect(manager.getAccessToken()).rejects.toMatchObject({ kind: "authentication" });
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("rejects a token response with a non-positive expiry before ever caching it", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValue({ accessToken: "token-1", expiresInSeconds: 0, scopes: [] });
    const manager = new JiraTokenManager({ fetchToken });

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(ConnectorError);
  });

  it("never leaks the raw fetch failure's message verbatim (only a generic authentication failure)", async () => {
    const fetchToken = vi.fn().mockRejectedValue(new Error("client_secret=super-secret-value"));
    const manager = new JiraTokenManager({ fetchToken });

    try {
      await manager.getAccessToken();
      throw new Error("expected getAccessToken to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      const message = JSON.stringify((err as ConnectorError).toData());
      expect(message).not.toContain("super-secret-value");
    }
  });

  it("invalidate() forces the next call to re-fetch even within the TTL", async () => {
    const fetchToken = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token-1", expiresInSeconds: 3600, scopes: [] })
      .mockResolvedValueOnce({ accessToken: "token-2", expiresInSeconds: 3600, scopes: [] });
    const manager = new JiraTokenManager({ fetchToken });

    await manager.getAccessToken();
    manager.invalidate();
    const second = await manager.getAccessToken();

    expect(second.accessToken).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("concurrent calls before the first resolution share a single in-flight fetch (never double-fetches)", async () => {
    let resolveFetch!: (value: {
      accessToken: string;
      expiresInSeconds: number;
      scopes: readonly string[];
    }) => void;
    const fetchToken = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const manager = new JiraTokenManager({ fetchToken });

    const p1 = manager.getAccessToken();
    const p2 = manager.getAccessToken();
    resolveFetch({ accessToken: "token-1", expiresInSeconds: 3600, scopes: [] });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.accessToken).toBe("token-1");
    expect(r2.accessToken).toBe("token-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});
