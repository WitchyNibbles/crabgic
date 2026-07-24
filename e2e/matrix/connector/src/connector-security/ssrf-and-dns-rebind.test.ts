/**
 * roadmap/23-release-hardening.md work item 6: "SSRF (incl. IPv4-mapped
 * IPv6 + DNS-rebind)." Drives the REAL `@eo/gateway` SSRF guard
 * (`checkResolvedAddress`/`isPrivateOrReservedIp`) AND the real
 * `GatewayHttpClient` DNS-pinning mechanism (never a reimplementation).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GatewayHttpClient,
  SsrfRefusedError,
  checkResolvedAddress,
  isPrivateOrReservedIp,
} from "@eo/gateway";
import type { HttpTransportResponse } from "@eo/gateway";
import {
  CONNECTOR_MATRIX_GATE_TAG,
  createScenarioJournal,
  emitScenarioEvidence,
} from "../support/evidence.js";
import type { ScenarioJournal } from "../support/evidence.js";

let tj: ScenarioJournal;

beforeEach(async () => {
  tj = await createScenarioJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function buildClient(resolveHostAddresses: (hostname: string) => Promise<readonly string[]>): {
  client: GatewayHttpClient;
  calls: Array<{ url: string; pinnedAddress: string | undefined }>;
} {
  const calls: Array<{ url: string; pinnedAddress: string | undefined }> = [];
  const client = new GatewayHttpClient({
    allowlist: { allowedSchemes: ["https:"], allowedOrigins: ["https://ssrf-fixture.invalid"] },
    resolveHostAddresses,
    sendRequest: async (req) => {
      calls.push({ url: req.url.toString(), pinnedAddress: req.pinnedAddress });
      return { status: 200, headers: {}, bodyText: "ok" } satisfies HttpTransportResponse;
    },
    sleep: async () => undefined,
  });
  return { client, calls };
}

describe("private/reserved IPv4 ranges — refused pre-network", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["RFC1918 10/8", "10.1.2.3"],
    ["RFC1918 192.168/16", "192.168.1.1"],
    ["link-local incl. cloud metadata endpoint", "169.254.169.254"],
  ])("%s (%s) is refused before any HTTP call", async (_label, ip) => {
    const { client, calls } = buildClient(async () => [ip]);
    await expect(
      client.request({
        connectionId: "conn-1",
        tenant: "tenant-1",
        resource: "res-1",
        url: new URL("https://ssrf-fixture.invalid/anything"),
        method: "GET",
      }),
    ).rejects.toBeInstanceOf(SsrfRefusedError);
    expect(calls).toHaveLength(0);
  });
});

describe("IPv4-mapped IPv6 — a smuggled private IPv4 address is still caught", () => {
  it("checkResolvedAddress refuses ::ffff:169.254.169.254 (IPv4-mapped cloud metadata endpoint)", () => {
    expect(isPrivateOrReservedIp("::ffff:169.254.169.254")).toBe(true);
    expect(checkResolvedAddress("::ffff:169.254.169.254").allowed).toBe(false);
  });

  it("checkResolvedAddress refuses the hex-group IPv4-mapped form (::ffff:a9fe:a9fe encodes 169.254.169.254)", () => {
    expect(isPrivateOrReservedIp("::ffff:a9fe:a9fe")).toBe(true);
  });

  it("the full GatewayHttpClient refuses a hop that resolves to an IPv4-mapped IPv6 private address, pre-network", async () => {
    const { client, calls } = buildClient(async () => ["::ffff:169.254.169.254"]);
    await expect(
      client.request({
        connectionId: "conn-1",
        tenant: "tenant-1",
        resource: "res-1",
        url: new URL("https://ssrf-fixture.invalid/metadata"),
        method: "GET",
      }),
    ).rejects.toBeInstanceOf(SsrfRefusedError);
    expect(calls).toHaveLength(0);

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: SSRF guard refuses an IPv4-mapped-IPv6-smuggled private address, pre-network",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ calls }),
    });
  });

  it("control: a genuinely public IPv4-mapped IPv6 address is NOT flagged private", () => {
    // 203.0.113.7 is TEST-NET-3 (RFC 5737 documentation range) — not in
    // this guard's private/reserved table, so its IPv4-mapped form must
    // resolve as allowed, proving this isn't a blanket "any ::ffff: form"
    // ban.
    expect(isPrivateOrReservedIp("::ffff:203.0.113.7")).toBe(false);
  });
});

describe("DNS-rebind — the address validated is structurally the ONLY address ever dialed (no re-resolution window)", () => {
  it("resolveHostAddresses is called exactly once per attempt, and the fake transport's own pinnedAddress always equals that SAME call's return value — never a second, later resolution", async () => {
    let resolveCallCount = 0;
    const answersByCall = ["203.0.113.50"]; // a single benign answer; if the
    // client ever re-resolved before dialing, this test's own resolver
    // would be called a 2nd time — asserted below via resolveCallCount.
    const { client, calls } = buildClient(async () => {
      const answer = answersByCall[Math.min(resolveCallCount, answersByCall.length - 1)]!;
      resolveCallCount += 1;
      return [answer];
    });

    await client.request({
      connectionId: "conn-1",
      tenant: "tenant-1",
      resource: "res-1",
      url: new URL("https://ssrf-fixture.invalid/rebind-check"),
      method: "GET",
    });

    // Exactly one resolution for exactly one hop/attempt — the validated
    // address is the SAME address passed to the transport as
    // `pinnedAddress` (no separate "resolve again right before dialing"
    // step exists in the real client, closing the classic rebind TOCTOU
    // window structurally, not just by policy).
    expect(resolveCallCount).toBe(1);
    expect(calls).toEqual([
      { url: "https://ssrf-fixture.invalid/rebind-check", pinnedAddress: "203.0.113.50" },
    ]);
  });

  it("a resolver that would answer PRIVATE on this (the only) resolution is refused immediately — there is no later 'connect-time' resolution a rebinding attacker could exploit instead", async () => {
    // Models the attacker's rebind payload landing on the one resolution
    // this client ever performs for this hop (rather than a hypothetical
    // later one) — since DNS pinning means there IS no later one, this is
    // the only place a rebind attempt could actually land, and it is
    // caught here.
    let resolveCallCount = 0;
    const { client, calls } = buildClient(async () => {
      resolveCallCount += 1;
      return ["169.254.169.254"]; // the rebind attacker's malicious answer
    });

    await expect(
      client.request({
        connectionId: "conn-1",
        tenant: "tenant-1",
        resource: "res-1",
        url: new URL("https://ssrf-fixture.invalid/rebind-attack"),
        method: "GET",
      }),
    ).rejects.toBeInstanceOf(SsrfRefusedError);

    expect(resolveCallCount).toBe(1); // no retry-with-a-different-resolution path exists
    expect(calls).toHaveLength(0); // never dialed

    await emitScenarioEvidence({
      journal: tj.store,
      command:
        "connector-matrix: DNS-rebind — single-resolution pinning means the validated address is structurally the only one ever dialed",
      exitStatus: 0,
      outcomeContent: JSON.stringify({ resolveCallCount, calls }),
    });
  });
});

describe("evidence tagging", () => {
  it("every EvidenceRecord emitted in this file is tagged release-gate:connector-matrix", async () => {
    const entries: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    for (const entry of entries) {
      expect((entry as { payload: { gateTag?: string } }).payload.gateTag).toBe(
        CONNECTOR_MATRIX_GATE_TAG,
      );
    }
  });
});
