/**
 * roadmap/09-cli-and-doctor.md §Test plan, Conformance: "snapshot tests for
 * help text and every `--json` output schema, including `gateway mcp`'s
 * tool-listing shape; `gateway mcp`'s stdio boot invocation is
 * byte-compared against the exact string 10's `.mcp.json` entry uses
 * (`crabgic gateway mcp`)." Exit criterion `cli.snapshots.test`.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { ProposalRegistry } from "@crabgic/learning";
import {
  ApprovalTokenMinter as ContractsApprovalTokenMinter,
  CURRENT_SCHEMA_VERSION,
  EnvelopePolicySchema,
} from "@crabgic/contracts";
import { createApprovalLedger, createCapabilityStore } from "@crabgic/detect";
import type { TrustCommandDependencies } from "@crabgic/detect";
import { FileExternalConnectionStore } from "@crabgic/gateway";
import { FileJiraConnectionConfigStore } from "../connection/jira-config-store.js";
import {
  buildAuthorizationEnvelope,
  buildChangeSet,
  buildEvidenceRecord,
  buildIntentContract,
} from "@crabgic/testkit";
import {
  buildSupervisorRouter,
  createArtifactIndexRegistry,
  createAuthorizationEnvelopesRegistry,
  createChangeSetsRegistry,
  createIntentContractsRegistry,
  createRequirementsRegistry,
  createRunsRegistry,
  createWorkUnitsRegistry,
  createWorkersRegistry,
  readPeerCredentialsLinux,
  startSupervisorServer,
  type IntakeRequest,
  type SupervisorServer,
} from "@crabgic/supervisor";
import { parseCommand } from "../argv/parse-command.js";
import type { ConnectionDependencies } from "../connection/connection-commands.js";
import { createToolRegistry } from "../gateway-mcp/registry.js";
import { connectUdsClient } from "../uds-client/client.js";
import { ApprovalTokenMinter } from "../approval/token.js";
import type { ApprovalPromptIo } from "../approval/prompt.js";
import type { LearningDependencies } from "../learning/learning-dependencies.js";
import { buildNotImplementedShape } from "./not-implemented.js";
import { dispatchCommand } from "./dispatch.js";
import type { CliDependencies } from "./types.js";
import { BINARY_NAME, COMMAND_HELP, renderHelp } from "./help.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("help text snapshots", () => {
  it("top-level help (human) is snapshot-stable", () => {
    const result = renderHelp({ command: "help", json: false });
    expect(result.stdout).toMatchSnapshot();
  });

  it("top-level help (--json) is snapshot-stable", () => {
    const result = renderHelp({ command: "help", json: true });
    expect(result.stdout).toMatchSnapshot();
  });

  it("topic help for every declared command is snapshot-stable", () => {
    for (const topic of Object.keys(COMMAND_HELP)) {
      const result = renderHelp({ command: "help", json: false, topic });
      expect(result.stdout).toMatchSnapshot(`topic-${topic}`);
    }
  });

  it("gateway mcp has its own help entry", () => {
    expect(COMMAND_HELP["gateway"]?.usage).toBe(`${BINARY_NAME} gateway mcp`);
  });

  /**
   * Top-level help groups commands by task instead of listing all fourteen
   * flat. Grouping introduces a failure mode a flat list did not have: a
   * command declared in `COMMAND_HELP` but missing from `COMMAND_GROUPS` could
   * disappear from the one screen that tells an operator it exists. The
   * fallback group is what prevents that, and this is what proves the fallback
   * is wired — a snapshot would not, because a snapshot of a screen with a
   * missing command looks exactly like a correct one.
   */
  it("lists every declared command exactly once", () => {
    const stdout = renderHelp({ command: "help", json: false }).stdout ?? "";
    // Matched in the KEY COLUMN only (indent, then the name, then the gap).
    // A looser "appears anywhere" match counts the word inside a neighbouring
    // summary — "Dispatch a new run." made `run` look duplicated.
    const named = stdout
      .split("\n")
      .map((line) => /^ {2}(\S+) {2,}\S/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined);
    expect([...named].sort()).toEqual(Object.keys(COMMAND_HELP).sort());
  });

  it("keeps the top-level screen free of the long usage strings", () => {
    const stdout = renderHelp({ command: "help", json: false }).stdout ?? "";
    // `connection`'s usage alone is >200 chars and wraps into a paragraph of
    // flags. It belongs to `help connection`, not to the first screen.
    expect(stdout).not.toContain("--base-url");
    expect(renderHelp({ command: "help", json: false, topic: "connection" }).stdout).toContain(
      "--base-url",
    );
    for (const line of stdout.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("--json output schema snapshots", () => {
  it("NOT_IMPLEMENTED shape is snapshot-stable", () => {
    expect(buildNotImplementedShape("install")).toMatchSnapshot();
  });

  it("gateway mcp's tool-listing shape (empty registry) is snapshot-stable", () => {
    expect({ tools: createToolRegistry().list() }).toMatchSnapshot();
  });

  it("gateway mcp's tool-listing shape (one registered tool) is snapshot-stable", () => {
    const registry = createToolRegistry();
    registry.register({
      name: "tracker.search",
      description: "Search the tracker.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    });
    expect({ tools: registry.list() }).toMatchSnapshot();
  });
});

describe("gateway mcp — exact stdio boot invocation (byte-compared against 10's .mcp.json entry)", () => {
  it('parses ["gateway", "mcp"] to the gateway-mcp command with no flags', () => {
    expect(parseCommand(["gateway", "mcp"])).toEqual({ command: "gateway-mcp" });
  });

  it('BINARY_NAME is exactly "crabgic"', () => {
    expect(BINARY_NAME).toBe("crabgic");
  });

  it('the exact invocation string "crabgic gateway mcp" round-trips through this package\'s own argv split', () => {
    const invocation = `${BINARY_NAME} gateway mcp`;
    const [, ...argv] = invocation.split(" ");
    expect(parseCommand(argv)).toEqual({ command: "gateway-mcp" });
  });

  it("package.json's own bin entry is keyed exactly BINARY_NAME — the literal 10's .mcp.json command field must match", async () => {
    const raw = await readFile(join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { readonly bin?: Record<string, string> };
    expect(pkg.bin?.[BINARY_NAME]).toBe("dist/bin.js");
  });

  /**
   * The supervisor daemon's entry point moved here from `packages/supervisor`
   * (2026-07-25) because the real `ClaudeEngineAdapter` it must construct
   * lives in `@crabgic/engine-claude`, which already depends on `@crabgic/supervisor` —
   * composing them there would have been a cycle. It is a SECOND, separately
   * named binary: `crabgic` itself is untouched, so 10's
   * `.mcp.json` command field still resolves exactly as asserted above.
   * Pinned here so a third bin entry cannot appear unnoticed. Both targets lost their leading `./` on 2026-08-07 (npm's own normalizer strips it, and the v1.6.0 publish log said so misleadingly) — this assertion's SUBJECT is the key set, and `.mcp.json`'s `command` field is the key `crabgic`, never the target path, so the literals moved with the manifest rather than the manifest being held back by them. The general invariant now lives in `scripts/check-published-tarball.mjs`.
   */
  it("declares exactly the two expected bin entries — the CLI and the separately-named supervisor daemon", async () => {
    const raw = await readFile(join(PACKAGE_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { readonly bin?: Record<string, string> };
    expect(pkg.bin).toEqual({
      [BINARY_NAME]: "dist/bin.js",
      [`${BINARY_NAME}-supervisord`]: "dist/bin/supervisord.js",
    });
  });
});

/* ------------------------------------------------------------------------ *
 * `--json` OUTPUT SCHEMA SNAPSHOTS — the "every" half of this suite's own
 * exit criterion.
 *
 * WHAT WAS HERE BEFORE, counted rather than characterised: the committed
 * `.snap` held 19 entries — 2 top-level help + 14 topic help + 3 non-help
 * (the NOT_IMPLEMENTED shape and two `gateway mcp` tool listings). No
 * snapshot existed for `doctor`, `evidence`, `status`, `cancel`, `resume`,
 * `run`, `approve`, the installer trio, `trust *`, `connection *`, or
 * `learn *`.
 *
 * THE ENUMERATION THE STRONG QUANTIFIER DEMANDS, counted from
 * `../argv/types.ts:156-179` and not from the help table: `ParsedCommand` has
 * exactly 23 members. 22 of them extend `JsonFlag`; `GatewayMcpCommand`
 * (`../argv/types.ts:146-149`) is the sole exception — it declares no
 * user-facing flags at all (interface-ledger Gap 2) and its stdio
 * tool-listing shape is already snapshotted above.
 *
 * EVERY case below drives the REAL `dispatchCommand` with a real dependency
 * bag — never a backend function called directly — so each snapshot pins
 * parser -> dispatch -> backend -> `formatJson` end to end.
 * ------------------------------------------------------------------------ */

const UUID_BODY = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/**
 * GLOBAL, not anchored — and that distinction was found by measurement, not
 * foresight. An anchored (whole-string) uuid rule let two ids through inside
 * prose: `rollbackStrategy` renders "Promoted learning proposal <id>: revert
 * the integration commit …". Those ids are `randomUUID()` per run, so the
 * generated `.snap` would have been green on the machine that wrote it and
 * red on the next one. The `snapshotSafe` guard below now asserts that no raw
 * uuid survives anywhere, so this class of miss announces itself instead of
 * shipping.
 */
const UUID_ANYWHERE = new RegExp(UUID_BODY, "gi");
const ISO_ANYWHERE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g;
/**
 * Anchored on purpose, unlike the two above. A BARE 64-hex string is a random
 * per-run digest and must go. A PREFIXED one (`"sha256:1c40…"`) is a content
 * hash derived from a fixed fixture — deterministic across machines, and
 * genuinely load-bearing: it is what makes a change to the envelope's canonical
 * form or its hashing show up here. Those are kept verbatim.
 */
const HEX64_WHOLE = /^[0-9a-f]{64}$/i;

/**
 * Volatile-value normalizer. Applied to PARSED json, never to the raw string,
 * then re-serialized by the snapshot — so the SHAPE stays load-bearing while
 * host- and run-specific values do not.
 *
 * KEYS ARE NEVER REWRITTEN, only values. That is what keeps these snapshots
 * from "passing for free": a renamed or added field changes the snapshot even
 * though every value in it is a placeholder. `keyHint` selects on the key and
 * still emits the key unchanged.
 */
function normalizeJson(value: unknown, keyHint?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeJson(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeJson(v, k)]),
    );
  }
  if (typeof value === "string") {
    if (keyHint === "token") return "<token>"; // HMAC token: different bytes every run
    // Checked BEFORE the substitutions: a tmp path can itself contain a uuid.
    if (value.startsWith(tmpdir())) return "<tmpdir-path>";
    if (HEX64_WHOLE.test(value)) return "<sha256>";
    return value.replace(UUID_ANYWHERE, "<uuid>").replace(ISO_ANYWHERE, "<timestamp>");
  }
  return value;
}

/**
 * Normalize, then PROVE nothing host-specific survived.
 *
 * A snapshot that quietly embeds `/tmp/eo-abc123/…` or a runner's `/home/…`
 * is not snapshot-STABLE — it passes on the machine that generated it and
 * reds everywhere else. This guard is asserted rather than left to review,
 * because "I read the .snap carefully" is exactly the kind of claim this
 * repository has learned not to trust.
 */
function snapshotSafe(value: unknown): unknown {
  const normalized = normalizeJson(value);
  const serialized = JSON.stringify(normalized);
  expect(serialized).not.toMatch(/"\/(tmp|home|Users|var|root)\//);
  expect(serialized).not.toContain(PACKAGE_ROOT);
  // No raw uuid may survive ANYWHERE, including inside prose. This is the
  // assertion that caught two `rollbackStrategy` ids the first draft missed.
  expect(serialized).not.toMatch(new RegExp(UUID_BODY, "i"));
  // No BARE 64-hex digest either. A `sha256:`-prefixed content hash is
  // deliberately exempt (see HEX64_WHOLE) and does not match this.
  expect(serialized).not.toMatch(/"[0-9a-f]{64}"/i);
  return normalized;
}

/**
 * Parse -> normalize -> RE-SERIALIZE THROUGH `formatJson`'s exact expression,
 * and snapshot the string.
 *
 * Snapshotting the normalized OBJECT instead would silently drop key ORDER:
 * vitest's serializer sorts a plain object's keys, so `{approved, changeSetId,
 * state, dispatch}` and `{approved, changeSetId, dispatch, state}` produce
 * byte-identical snapshots. `formatJson` is `JSON.stringify(value, null, 2)`
 * (`@crabgic/contracts`' command-result.ts) — insertion-ordered and
 * deterministic per code path — so the bytes a `--json` consumer actually
 * receives DO carry an order, and this is what pins it. Normalizing before
 * re-serializing is safe for order: `Object.fromEntries(Object.entries(…))`
 * preserves insertion order.
 */
function parsedJson(stdout: string | undefined): string {
  return `${JSON.stringify(snapshotSafe(JSON.parse(stdout!)), null, 2)}\n`;
}

/**
 * `doctor --json` is the one host-DEPENDENT surface here: verdicts and
 * evidence vary with engine presence, `bwrap`, `git`, XDG modes and WSL2. So
 * it is reduced to the SHAPE the criterion protects — the closed id set, the
 * closed set of finding key-sets, and the top-level key set. Verdict values
 * are deliberately excluded; `repairStep` presence is verdict-dependent,
 * which is why the key-sets are de-duplicated into a SET of key-sets rather
 * than listed per finding: the set of variants is host-stable because the
 * SCHEMA is, even though which variant each finding takes is not.
 */
function doctorShape(stdout: string | undefined): unknown {
  const parsed = JSON.parse(stdout!) as {
    findings: Record<string, unknown>[];
    allPassed: boolean;
  };
  return {
    topLevelKeys: Object.keys(parsed).sort(),
    findingIds: parsed.findings.map((f) => f["id"]),
    findingKeySets: [
      ...new Set(parsed.findings.map((f) => Object.keys(f).sort().join(","))),
    ].sort(),
    allPassedType: typeof parsed.allPassed,
  };
}

describe("--json output schema snapshots — the normalizer's own contract", () => {
  it("rewrites VALUES and never KEYS — the property that stops these snapshots passing for free", () => {
    const normalized = normalizeJson({
      token: "aaaa",
      id: "11111111-1111-4111-8111-111111111111",
      capturedAt: "2026-08-06T12:00:00.000Z",
      digest: "a".repeat(64),
      plain: "left alone",
      // The prose case the first draft missed: a uuid EMBEDDED in a sentence.
      rollbackStrategy: "Promoted learning proposal 162dd815-0bbb-48f6-a454-31b28431c9e9: revert.",
      // …and a `sha256:`-prefixed content hash, which must SURVIVE.
      canonicalHash: `sha256:${"b".repeat(64)}`,
      nested: [{ token: "bbbb" }],
    });
    expect(normalized).toEqual({
      token: "<token>",
      id: "<uuid>",
      capturedAt: "<timestamp>",
      digest: "<sha256>",
      plain: "left alone",
      rollbackStrategy: "Promoted learning proposal <uuid>: revert.",
      canonicalHash: `sha256:${"b".repeat(64)}`,
      nested: [{ token: "<token>" }],
    });
    // Stated as its own assertion because it is the load-bearing half.
    expect(Object.keys(normalized as object)).toEqual([
      "token",
      "id",
      "capturedAt",
      "digest",
      "plain",
      "rollbackStrategy",
      "canonicalHash",
      "nested",
    ]);
  });

  it("snapshotSafe REFUSES what the normalizer could not reach — the guard has been seen to fail", () => {
    // An assertion nobody has watched fail is not yet known to be non-vacuous,
    // so the guard is mutation-tested in both directions.
    // PASSES: values the normalizer does reach.
    expect(() => snapshotSafe({ note: "id 162dd815-0bbb-48f6-a454-31b28431c9e9" })).not.toThrow();
    expect(() => snapshotSafe({ canonicalHash: `sha256:${"b".repeat(64)}` })).not.toThrow();
    // REFUSES: keys are never rewritten, so a volatile value hiding in a KEY
    // escapes the normalizer entirely — and must not escape the guard.
    expect(() => snapshotSafe({ "162dd815-0bbb-48f6-a454-31b28431c9e9": 1 })).toThrow();
    expect(() => snapshotSafe({ ["a".repeat(64)]: 1 })).toThrow();
    // REFUSES: a host path that is not under this process's tmpdir.
    expect(() => snapshotSafe({ path: "/home/runner/work/crabgic/checkout" })).toThrow();
  });
});

/* ---- Fixture: a real supervisor in a tmp dir, exactly as
 * `./cli.commands.schema.test.ts` stands one up. ---- */

const FIXED_RUN_ID = "11111111-1111-4111-8111-111111111111";
const FIXED_CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
let trustCounter = 0;
let connectionCounter = 0;
let installCounter = 0;

let snapRoot: string;
let snapJournal: JournalStore;
let snapServer: SupervisorServer | undefined;
let snapDeps: CliDependencies;

beforeEach(async () => {
  snapRoot = await mkdtemp(join(tmpdir(), "eo-cli-snapshots-"));
  snapJournal = createJournalStore({ journalDir: join(snapRoot, "journal") });
  const router = buildSupervisorRouter({
    journal: snapJournal,
    runs: createRunsRegistry(),
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    workers: createWorkersRegistry(),
    artifactIndex: createArtifactIndexRegistry(),
    requirements: createRequirementsRegistry(),
    envelopes: createAuthorizationEnvelopesRegistry(),
    liveWorkers: new Map(),
  });
  const runtimeDir = join(snapRoot, "run");
  const socketPath = join(runtimeDir, "control.sock");
  snapServer = await startSupervisorServer({
    runtimeDir,
    socketPath,
    router,
    peerAuth: { reader: readPeerCredentialsLinux },
  });
  snapDeps = {
    connectClient: () => connectUdsClient({ socketPath }),
    journal: snapJournal,
    projectHash: "test-project-hash",
    resolveAuthState: () => Promise.resolve("valid"),
  };
});

afterEach(async () => {
  await snapServer?.close();
  snapServer = undefined;
  await rm(snapRoot, { recursive: true, force: true });
});

describe("--json output schema snapshots — doctor (shape-reduced: host-independent)", () => {
  it("doctor --json finding shape and id set are snapshot-stable", async () => {
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: false, json: true },
      snapDeps,
    );
    expect(doctorShape(result.stdout)).toMatchSnapshot();
  });

  it("doctor --repair-plan --json adds exactly the repairPlan member", async () => {
    const result = await dispatchCommand(
      { command: "doctor", repairPlan: true, json: true },
      snapDeps,
    );
    expect(
      (doctorShape(result.stdout) as { topLevelKeys: string[] }).topLevelKeys,
    ).toMatchSnapshot();
  });
});

describe("--json output schema snapshots — supervisor-backed commands (status/cancel/resume/evidence)", () => {
  it("status <run-id> --json (unknown run)", async () => {
    const result = await dispatchCommand(
      { command: "status", runId: FIXED_RUN_ID, watch: false, json: true },
      snapDeps,
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("status (no run-id) --json on a fresh daemon", async () => {
    const result = await dispatchCommand({ command: "status", watch: false, json: true }, snapDeps);
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("cancel <target-id> --json (unknown run)", async () => {
    const result = await dispatchCommand(
      { command: "cancel", targetId: FIXED_RUN_ID, json: true },
      snapDeps,
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("resume <run-id> --json — the daemon's own refusal prose, pinned verbatim", async () => {
    // This daemon is composed WITHOUT a run dispatcher, so the refusal proves
    // the command genuinely round-trips to the supervisor. The reason string
    // is daemon-owned and deterministic per build; drift in it is exactly the
    // interface drift this criterion exists to catch, so it is NOT normalized.
    const result = await dispatchCommand(
      { command: "resume", runId: FIXED_RUN_ID, json: true },
      snapDeps,
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("evidence <change-set-id> --json (empty report)", async () => {
    const result = await dispatchCommand(
      { command: "evidence", changeSetId: FIXED_CHANGE_SET_ID, json: true },
      snapDeps,
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

/* ---- Fixture: the real `learn` backend, exactly as
 * `../learning/learn-command-backend.test.ts:31-48` builds it. ---- */

const LEARN_CHANGE_SET_REFS = {
  intentContractId: "11111111-1111-4111-8111-111111111111",
  authorizationEnvelopeId: "22222222-2222-4222-8222-222222222222",
  capabilityManifestId: "33333333-3333-4333-8333-333333333333",
  provisionalPerformanceContractId: "44444444-4444-4444-8444-444444444444",
};

/** Microtask-driven terminal confirmation — no timers, no wall-clock hold. */
function yesIo(): ApprovalPromptIo {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  queueMicrotask(() => input.write("yes\n"));
  return { input, output };
}

async function newLearningDeps(io?: ApprovalPromptIo): Promise<LearningDependencies> {
  const journal = createJournalStore({ journalDir: join(snapRoot, "learn-journal") });
  const sharedKey = randomBytes(32);
  return {
    registry: new ProposalRegistry({ registryDir: join(snapRoot, "learn-registry"), journal }),
    journal,
    minter: new ApprovalTokenMinter({ secretKey: sharedKey, journal }),
    secretKey: sharedKey,
    resolveChangeSetRefs: () => LEARN_CHANGE_SET_REFS,
    ...(io !== undefined ? { io } : {}),
  };
}

async function advanceToIndependentReview(
  learning: LearningDependencies,
  proposalId: string,
): Promise<void> {
  for (const to of [
    "reproducer",
    "candidate",
    "dev_eval",
    "held_out_eval",
    "shadow_run",
    "independent_review",
  ] as const) {
    await learning.registry.transition(proposalId, to);
  }
}

/**
 * roadmap/22 exit criterion 6's third conjunct — "(golden CLI-output test)".
 * Nothing pinned any of these five payload shapes before: the backend suite
 * uses `toMatchObject`, which passes for a re-ordered or extra-keyed payload.
 * Measured: adding a key to `learn list --json`'s payload left the whole
 * `packages/cli` suite green at 100 files / 1175 tests.
 */
describe("--json output schema snapshots — learn list|approve|reject|rollback (roadmap/22's golden CLI-output test)", () => {
  it("learn list --json (empty registry)", async () => {
    const result = await dispatchCommand(
      { command: "learn-list", json: true },
      { ...snapDeps, learning: await newLearningDeps() },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("learn list --json (one proposal)", async () => {
    const learning = await newLearningDeps();
    await learning.registry.create({ content: "always re-check X" });
    const result = await dispatchCommand(
      { command: "learn-list", json: true },
      { ...snapDeps, learning },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("learn list (human mode, one proposal) — golden CLI output", async () => {
    const learning = await newLearningDeps();
    const proposal = await learning.registry.create({ content: "always re-check X" });
    const result = await dispatchCommand(
      { command: "learn-list", json: false },
      { ...snapDeps, learning },
    );
    // Raw human output, with the one volatile value substituted by hand.
    expect(result.stdout!.replaceAll(proposal.id, "<uuid>")).toMatchSnapshot();
  });

  it("learn list (human mode, empty registry) — golden CLI output", async () => {
    const result = await dispatchCommand(
      { command: "learn-list", json: false },
      { ...snapDeps, learning: await newLearningDeps() },
    );
    expect(result.stdout).toMatchSnapshot();
  });

  it("learn approve --json (1 of 2 — records an approval, does not promote)", async () => {
    const learning = await newLearningDeps(yesIo());
    const proposal = await learning.registry.create({ content: "lesson" });
    await advanceToIndependentReview(learning, proposal.id);
    const result = await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...snapDeps, learning },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("learn approve --json (2 of 2 — promoted, with the constructed ChangeSet)", async () => {
    const learning = await newLearningDeps();
    const proposal = await learning.registry.create({ content: "lesson" });
    await advanceToIndependentReview(learning, proposal.id);
    // Two sequential dispatches, each with a FRESH prompt — two distinct
    // tokens, exactly as two separate `learn approve` invocations would.
    await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...snapDeps, learning: { ...learning, io: yesIo() } },
    );
    const result = await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...snapDeps, learning: { ...learning, io: yesIo() } },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("learn approve (human mode, 1 of 2) — golden CLI output", async () => {
    const learning = await newLearningDeps(yesIo());
    const proposal = await learning.registry.create({ content: "lesson" });
    await advanceToIndependentReview(learning, proposal.id);
    const result = await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: false },
      { ...snapDeps, learning },
    );
    expect(result.stdout!.replaceAll(proposal.id, "<uuid>")).toMatchSnapshot();
  });

  it("learn reject --json", async () => {
    const learning = await newLearningDeps();
    const proposal = await learning.registry.create({ content: "lesson" });
    const result = await dispatchCommand(
      { command: "learn-reject", proposalId: proposal.id, json: true },
      { ...snapDeps, learning },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("learn rollback --json (of a genuinely promoted proposal)", async () => {
    const learning = await newLearningDeps();
    const proposal = await learning.registry.create({ content: "lesson" });
    await advanceToIndependentReview(learning, proposal.id);
    await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...snapDeps, learning: { ...learning, io: yesIo() } },
    );
    await dispatchCommand(
      { command: "learn-approve", proposalId: proposal.id, json: true },
      { ...snapDeps, learning: { ...learning, io: yesIo() } },
    );
    const result = await dispatchCommand(
      { command: "learn-rollback", proposalId: proposal.id, json: true },
      { ...snapDeps, learning },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

/* ---- evidence, populated. The empty report is pinned by
 * `./cli.commands.schema.test.ts` with an exact `toEqual`; what nothing pinned
 * is the RENDERING of a journaled `EvidenceRecord`, which is what a consumer
 * of `evidence <change-set-id> --json` actually parses. ---- */

describe("--json output schema snapshots — evidence, populated", () => {
  it("evidence --json over two journaled evidence_pointer records", async () => {
    const first = buildEvidenceRecord({
      changeSetId: FIXED_CHANGE_SET_ID,
      command: "npm test",
      id: "33333333-3333-4333-8333-333333333333",
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = buildEvidenceRecord({
      changeSetId: FIXED_CHANGE_SET_ID,
      command: "npm run lint",
      id: "44444444-4444-4444-8444-444444444444",
      capturedAt: "2026-01-01T00:00:01.000Z",
      exitStatus: 1,
    });
    await snapJournal.appendEntry({
      type: "evidence_pointer",
      changeSetId: FIXED_CHANGE_SET_ID,
      payload: first,
    });
    await snapJournal.appendEntry({
      type: "evidence_pointer",
      changeSetId: FIXED_CHANGE_SET_ID,
      payload: second,
    });

    const result = await dispatchCommand(
      { command: "evidence", changeSetId: FIXED_CHANGE_SET_ID, json: true },
      snapDeps,
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

/* ---- installer trio. `installer-dispatch.test.ts` field-picks; nothing pins
 * the serialized shape. ---- */

const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));

describe("--json output schema snapshots — install / upgrade / uninstall", () => {
  async function installerDeps(): Promise<CliDependencies> {
    const targetDir = join(snapRoot, `install-target-${String(installCounter++)}`);
    await mkdir(targetDir, { recursive: true });
    return {
      ...snapDeps,
      installer: {
        targetDir,
        pluginSourceDir: PLUGIN_ROOT,
        confirmGitInit: async () => true,
      },
    };
  }

  it("install --json", async () => {
    const result = await dispatchCommand(
      { command: "install", dryRun: false, json: true },
      await installerDeps(),
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("upgrade --json (immediately after a fresh install: up-to-date)", async () => {
    const deps = await installerDeps();
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand({ command: "upgrade", dryRun: false, json: true }, deps);
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("uninstall --json", async () => {
    const deps = await installerDeps();
    await dispatchCommand({ command: "install", dryRun: false, json: true }, deps);
    const result = await dispatchCommand(
      { command: "uninstall", keepState: false, json: true },
      deps,
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

/* ---- trust trio (@crabgic/detect backends, reached through this dispatcher). ---- */

describe("--json output schema snapshots — trust review / approve / revoke", () => {
  async function trustDeps(): Promise<TrustCommandDependencies> {
    const dir = join(snapRoot, `trust-${String(trustCounter++)}`);
    await mkdir(dir, { recursive: true });
    return {
      store: createCapabilityStore(dir, { journal: { appendEntry: async () => undefined } }),
      minter: new ContractsApprovalTokenMinter({ secretKey: randomBytes(32) }),
      approvalLedger: createApprovalLedger(dir),
    };
  }

  it("trust review --json (empty store)", async () => {
    const result = await dispatchCommand(
      { command: "trust-review", json: true },
      { ...snapDeps, trust: await trustDeps() },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("trust approve --json (minted, digest-bound token)", async () => {
    const result = await dispatchCommand(
      { command: "trust-approve", digest: "a".repeat(64), json: true },
      { ...snapDeps, trust: await trustDeps() },
    );
    // `token` is HMAC output and `tokenId`/`expiresAt` move every run — the
    // normalizer replaces the VALUES; the key set is what this pins.
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("trust revoke --json (unknown token id — the refusal shape)", async () => {
    const result = await dispatchCommand(
      { command: "trust-revoke", tokenId: "no-such-token", json: true },
      { ...snapDeps, trust: await trustDeps() },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

/* ---- connection family. ---- */

const CONNECTION_ADD = {
  command: "connection-add",
  allowBasicAuth: false,
  provider: "jira",
  reference: { raw: "env:JIRA_TOKEN" },
  usernameReference: { raw: "env:JIRA_EMAIL" },
  baseUrl: "https://example.atlassian.net",
  allowedRedirectOrigins: ["https://example.atlassian.net"],
  allowedResources: ["issue"],
  allowedActions: ["read"],
  discoveryTtlSeconds: 900,
  json: true,
} as const;

describe("--json output schema snapshots — connection add / list / doctor / capabilities", () => {
  async function connectionDeps(): Promise<ConnectionDependencies> {
    const dir = join(snapRoot, `conn-${String(connectionCounter++)}`);
    await mkdir(dir, { recursive: true });
    return {
      repository: new FileExternalConnectionStore(join(dir, "connections.json")),
      jiraConfigs: new FileJiraConnectionConfigStore(join(dir, "jira-connection-configs.json")),
      probe: () => Promise.resolve({ reachable: true, detail: "HTTP 200" }),
    };
  }

  it("connection add --json", async () => {
    const result = await dispatchCommand(CONNECTION_ADD, {
      ...snapDeps,
      connection: await connectionDeps(),
    });
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("connection list --json (one connection)", async () => {
    const connection = await connectionDeps();
    await dispatchCommand(CONNECTION_ADD, { ...snapDeps, connection });
    const result = await dispatchCommand(
      { command: "connection-list", json: true },
      { ...snapDeps, connection },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("connection doctor --json (reachable)", async () => {
    const connection = await connectionDeps();
    const added = await dispatchCommand(CONNECTION_ADD, { ...snapDeps, connection });
    const { id } = JSON.parse(added.stdout!) as { id: string };
    const result = await dispatchCommand(
      { command: "connection-doctor", connectionId: id, json: true },
      { ...snapDeps, connection },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("connection capabilities --json (injected discoverer)", async () => {
    const connection = await connectionDeps();
    const created = await connection.repository.create({
      provider: "grafana",
      baseUrl: "https://grafana.example.com",
      secretRef: { backend: "env", variable: "GRAFANA_TOKEN" },
      allowedRedirectOrigins: [],
      allowedResources: ["dashboard"],
      allowedActions: ["list"],
      discoveryTtlSeconds: 900,
    });
    const result = await dispatchCommand(
      { command: "connection-capabilities", connectionId: created.id, json: true },
      {
        ...snapDeps,
        connection: {
          ...connection,
          discoverCapabilities: async () => ({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id: "00000000-0000-4000-8000-0000000000cc",
            externalConnectionId: created.id,
            product: "grafana",
            edition: "oss",
            version: "13.1.0",
            apiFamilies: ["dashboard:legacy"],
            resources: ["dashboard"],
            actions: ["list"],
            permissions: ["read"],
            isReadOnly: true,
            discoveredAt: "2026-07-25T00:00:00.000Z",
            expiresAt: "2026-07-25T00:15:00.000Z",
          }),
        },
      },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

/* ---- `run` (deps.intake) and `approve` (deps.intake).
 *
 * DISCLOSED NARROWING #1, written here rather than left for a reader to
 * discover: `run --json` is ONE TypeScript payload shape —
 * `{ ...RunIntakeCommandResult, dispatch? }` — whose CONTENT union has five
 * decided-outcome arms (approved-and-dispatched, escalate, conflict,
 * not_ready, and already-in-a-non-ready-state). Three are snapshotted below.
 * The two that are not — `not_ready` and the already-state arm — produce the
 * IDENTICAL field set to the escalate arm (`real-handlers.ts:377-384` and
 * `:419-424` differ from `:386-413` only in the human message and the
 * `standing.status` literal), so no schema goes unpinned. A schema is not
 * every content arm, but this is stated so a judge can disagree with the
 * reading rather than have to find it.
 *
 * DISCLOSED NARROWING #2: `status --watch --json`'s final payload is
 * byte-produced by the SAME `formatJson(result)` expression as the non-watch
 * branch (`real-handlers.ts:185` vs `:151-152`) — the same schema, so it is
 * not separately snapshotted.
 * ---- */

function fixtureIntakeRequest(ownedPaths: readonly string[] = []): IntakeRequest {
  return {
    requestKey: "repo:snapshot-test",
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-01-01T00:00:00.000Z",
    sections: {
      scope: "s",
      "non-goals": "n",
      audience: "a",
      compatibility: "c",
      security: "sec",
      performance: "p",
      observability: "o",
      rollout: "r",
      acceptance: "acc",
    },
    requirements: [],
    workUnits: [],
    envelopeContent: {
      ownedPaths: [...ownedPaths],
      commands: [],
      networkDestinations: [],
      credentialReferences: [],
      dependencies: [],
      remoteResourceAuthorizations: [],
      temporaryServices: [],
      prohibitedActions: [],
    },
    rollbackStrategy: "Revert the integration commit.",
  } as IntakeRequest;
}

function fixturePolicy() {
  return {
    status: "loaded" as const,
    policy: EnvelopePolicySchema.parse({
      maxWorkerTurnsPerAttempt: 40,
      schemaVersion: 1,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: "2026-01-01T00:00:00.000Z",
      allowedPathPrefixes: ["src"],
    }),
    digest: "sha256:standing",
  };
}

function acceptingClient(): CliDependencies["connectClient"] {
  return () =>
    Promise.resolve({
      request: () =>
        Promise.resolve({ accepted: true, runId: "44444444-4444-4444-8444-444444444444" }),
      close: () => Promise.resolve(),
    } as never);
}

function intakeBagFor(request: IntakeRequest, journal: JournalStore) {
  const secretKey = randomBytes(32);
  return {
    journal,
    changeSets: createChangeSetsRegistry(),
    workUnits: createWorkUnitsRegistry(),
    envelopes: createAuthorizationEnvelopesRegistry(),
    intentContracts: createIntentContractsRegistry(),
    requirements: createRequirementsRegistry(),
    minter: new ApprovalTokenMinter({ secretKey }),
    secretKey,
    readIntakeRequest: async () => request,
    io: { input: new PassThrough(), output: new PassThrough() },
    loadPolicy: fixturePolicy,
  };
}

describe("--json output schema snapshots — run (three of the five decided-outcome arms)", () => {
  it("run --json — approved under the standing policy, and dispatched", async () => {
    const result = await dispatchCommand(
      { command: "run", json: true },
      {
        ...snapDeps,
        connectClient: acceptingClient(),
        intake: intakeBagFor(fixtureIntakeRequest(), snapJournal),
      },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("run --json — escalate (the envelope claims authority the policy does not grant)", async () => {
    const result = await dispatchCommand(
      { command: "run", json: true },
      { ...snapDeps, intake: intakeBagFor(fixtureIntakeRequest(["infra/secrets"]), snapJournal) },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("run --json — conflict (same requestKey, different content, same journal)", async () => {
    await dispatchCommand(
      { command: "run", json: true },
      {
        ...snapDeps,
        connectClient: acceptingClient(),
        intake: intakeBagFor(fixtureIntakeRequest(), snapJournal),
      },
    );
    const result = await dispatchCommand(
      { command: "run", json: true },
      {
        ...snapDeps,
        connectClient: acceptingClient(),
        intake: intakeBagFor(
          { ...fixtureIntakeRequest(), rollbackStrategy: "Revert the feature flag instead." },
          snapJournal,
        ),
      },
    );
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});

describe("--json output schema snapshots — approve <digest>", () => {
  function seededApproveIntake(digest: string) {
    const changeSets = createChangeSetsRegistry();
    const envelopes = createAuthorizationEnvelopesRegistry();
    const intentContracts = createIntentContractsRegistry();
    const envelope = buildAuthorizationEnvelope({
      id: "55555555-5555-4555-8555-555555555555",
      canonicalHash: digest,
    });
    envelopes.put(envelope);
    const contract = buildIntentContract({
      id: "66666666-6666-4666-8666-666666666666",
      requirementIds: [],
    });
    intentContracts.put(contract);
    changeSets.put(
      buildChangeSet({
        id: "77777777-7777-4777-8777-777777777777",
        state: "awaiting_approval",
        authorizationEnvelopeId: envelope.id,
        intentContractId: contract.id,
      }),
    );

    const input = new PassThrough();
    const secretKey = randomBytes(32);
    return {
      input,
      intake: {
        journal: snapJournal,
        changeSets,
        workUnits: createWorkUnitsRegistry(),
        envelopes,
        intentContracts,
        requirements: createRequirementsRegistry(),
        minter: new ApprovalTokenMinter({ secretKey }),
        secretKey,
        readIntakeRequest: () => {
          throw new Error("approve never reads an intake request");
        },
        loadPolicy: () => {
          throw new Error("approve never reads the standing policy");
        },
        io: { input, output: new PassThrough() },
        resolveTerminal: () => ({ allowed: true }) as const,
      },
    };
  }

  it("approve --json — confirmed at the terminal, dispatched", async () => {
    const digest = "sha256:approve-happy";
    const seeded = seededApproveIntake(digest);
    const pending = dispatchCommand(
      { command: "approve", digest, json: true },
      { ...snapDeps, connectClient: acceptingClient(), intake: seeded.intake },
    );
    seeded.input.write("yes\n");
    const result = await pending;
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });

  it("approve --json — declined at the terminal (a closed, fully static payload)", async () => {
    const digest = "sha256:approve-decline";
    const seeded = seededApproveIntake(digest);
    const pending = dispatchCommand(
      { command: "approve", digest, json: true },
      { ...snapDeps, intake: seeded.intake },
    );
    seeded.input.write("no\n");
    const result = await pending;
    expect(parsedJson(result.stdout)).toMatchSnapshot();
  });
});
