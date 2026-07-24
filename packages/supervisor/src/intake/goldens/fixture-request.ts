/**
 * The canonical `IntakeRequest` fixture — roadmap/11-intake-contract-
 * approval.md §Test plan, Conformance: "hand-reviewed golden IntentContract/
 * DAG/AuthorizationEnvelope/CapabilityManifest fixtures, byte-stable across
 * two builds (mirrors 02's schema byte-stability criterion)." Fixed literal
 * ids/timestamps (never `crypto.randomUUID()`/`Date.now()`) so
 * `buildIntakeArtifacts` output is byte-stable across every run, on every
 * machine — mirrors `packages/engine-core/src/goldens/canonical-
 * envelopes.ts`'s own documented convention verbatim.
 *
 * LOW L6 repair (adversarial-validation finding): the requirement <->
 * work-unit mapping used to be degenerate (`WorkUnit.requirementIds: []`,
 * no `Requirement.workUnitIds`), so the golden fixture never actually
 * exercised the bidirectional-mapping property roadmap/11 names. Both
 * requirements now declare the `WorkUnit` id(s) that fulfill them, and both
 * work units declare the `Requirement` id(s) they fulfill — computed via
 * `computeIntentContractId`/`computeRequirementId` (the SAME derivation
 * `buildIntakeArtifacts` itself uses), so this stays deterministic/
 * byte-stable rather than a hand-typed, potentially-drifting duplicate.
 *
 * MEDIUM M3 repair: the pinned-engine entry is now derived from a real
 * (if trivial) `EngineAdapter`-shaped object's `capabilities()` call
 * (`FIXTURE_ENGINE_ADAPTER` below) via `engineAdapter`, rather than a bare
 * `engineEntry` literal — exercising the same `capabilities()` call path
 * `packages/cli`'s real orchestration (06's real adapter, once wired) will
 * use.
 */
import type { EngineAdapter, EngineCapabilities } from "@eo/engine-core";
import type { IntakeRequest } from "../intake-pipeline.js";
import { computeIntentContractId } from "../intake-pipeline.js";
import { computeRequirementId } from "../contract-builder.js";

export const FIXTURE_CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const WU_LOGIN_FORM = "22222222-1111-4111-8111-111111111111";
const WU_RATE_LIMIT = "33333333-1111-4111-8111-111111111111";

const INTENT_CONTRACT_ID = computeIntentContractId(FIXTURE_CHANGE_SET_ID);
const REQ_LOGIN_FORM = computeRequirementId(INTENT_CONTRACT_ID, {
  section: "scope",
  title: "Add login form",
});
const REQ_RATE_LIMIT = computeRequirementId(INTENT_CONTRACT_ID, {
  section: "security",
  title: "Rate-limit login attempts",
});

/**
 * A minimal, real `EngineAdapter`-shaped fixture — standing in for 06's own
 * real adapter (per roadmap/11 §Risks: "Until 06 lands for real,
 * `EngineAdapter.capabilities()` values used in the approval preview come
 * from 03's fake engine"). Only `capabilities()` is ever called by
 * `buildCapabilityManifest`'s `engineAdapter` parameter, so the other 3
 * `EngineAdapter` methods are stubbed as unreachable rather than
 * implemented — this is production `src` code (not a test file), so it
 * deliberately does NOT reach for `@eo/testkit`'s test-only
 * `FakeEngineAdapter`/`StubEngineAdapter`.
 */
export const FIXTURE_ENGINE_ADAPTER: Pick<EngineAdapter, "capabilities"> = {
  capabilities(): EngineCapabilities {
    return {
      engineVersion: "2.1.0-fixture",
      supportsJsonSchema: true,
      supportsSessionResume: true,
      permissionModel: "dontAsk",
      sandboxModel: "bubblewrap",
    };
  },
};

export const FIXTURE_INTAKE_REQUEST: IntakeRequest = {
  requestKey: "fixture:golden-repo",
  id: FIXTURE_CHANGE_SET_ID,
  createdAt: "2026-07-15T12:00:00.000Z",
  sections: {
    scope: "Add a login form to the example app.",
    "non-goals": "No SSO/OAuth integration in this change.",
    audience: "End users of the example app.",
    compatibility: "No breaking changes to the existing session API.",
    security: "Rate-limit login attempts; never log raw passwords.",
    performance: "Login submit responds within the p95 budget below.",
    observability: "Emit a login_attempt metric with outcome label.",
    rollout: "Ship behind no flag — small, additive UI change.",
    acceptance: "A user can log in with valid credentials and is rate-limited after 5 failures.",
  },
  requirements: [
    {
      section: "scope",
      title: "Add login form",
      description: "Render a login form and wire it to the existing session API.",
      acceptanceCriteria: ["A user can submit valid credentials and reach the dashboard."],
      workUnitIds: [WU_LOGIN_FORM],
    },
    {
      section: "security",
      title: "Rate-limit login attempts",
      description: "Reject a 6th attempt within 60s from the same account.",
      acceptanceCriteria: ["The 6th attempt within 60s is rejected with a 429."],
      workUnitIds: [WU_RATE_LIMIT],
    },
  ],
  workUnits: [
    {
      id: WU_LOGIN_FORM,
      title: "Implement login form",
      requirementIds: [REQ_LOGIN_FORM],
      dependsOn: [],
      role: "implementation",
      ownedPaths: ["packages/example/src/login/"],
    },
    {
      id: WU_RATE_LIMIT,
      title: "Implement login rate limiting",
      requirementIds: [REQ_RATE_LIMIT],
      dependsOn: [WU_LOGIN_FORM],
      role: "implementation",
      ownedPaths: ["packages/example/src/login/rate-limit.ts"],
    },
  ],
  envelopeContent: {
    ownedPaths: ["packages/example/src/login/"],
    commands: ["npm test", "npm run build"],
    networkDestinations: [],
    credentialReferences: [],
    dependencies: [],
    remoteResourceAuthorizations: [],
    temporaryServices: [],
    prohibitedActions: ["force-push main"],
  },
  rollbackStrategy: "Revert the integration commit; the login form is additive-only.",
  performanceBudgetSource: "requirement_acceptance_criteria",
  performanceBudgets: [{ metric: "latency", percentile: 95, threshold: 200, unit: "ms" }],
  capabilityManifest: {
    engineAdapter: FIXTURE_ENGINE_ADAPTER,
  },
};
