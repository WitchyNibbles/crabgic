import { CURRENT_SCHEMA_VERSION, IntentContractSchema, type IntentContract } from "@eo/contracts";
import { createFixtureContext } from "./context.js";

/** Deterministic `IntentContract` fixture builder — roadmap/02 work item 10. */
export function buildIntentContract(overrides: Partial<IntentContract> = {}): IntentContract {
  const ctx = createFixtureContext();
  const defaults: IntentContract = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: ctx.ids.next(),
    changeSetId: ctx.ids.next(),
    createdAt: ctx.clock.next(),
    sections: {
      scope: "Deterministic fixture scope statement.",
      "non-goals": "Deterministic fixture non-goals statement.",
      audience: "Deterministic fixture audience statement.",
      compatibility: "Deterministic fixture compatibility statement.",
      security: "Deterministic fixture security statement.",
      performance: "Deterministic fixture performance statement.",
      observability: "Deterministic fixture observability statement.",
      rollout: "Deterministic fixture rollout statement.",
      acceptance: "Deterministic fixture acceptance statement.",
    },
    requirementIds: [],
  };
  return IntentContractSchema.parse({ ...defaults, ...overrides });
}
