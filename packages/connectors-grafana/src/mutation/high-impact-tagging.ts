import type { HighImpactCapabilityFlag } from "@eo/contracts";
import { HIGH_IMPACT_FLAG_BY_KIND, type GrafanaResourceKind } from "../resource-kinds.js";

/**
 * Static high-impact-flag lookup — roadmap/20-grafana-adapters.md §In
 * scope, "High-impact flags": "every mutation touching one of these four
 * resource classes is statically tagged with the flag(s) it requires."
 *
 * `alert-rule` is special-cased, asymmetrically between create and update
 * (adversarial-review MEDIUM fix — the original version tagged ONLY an
 * explicit `isPaused` toggle, missing every other way an update can
 * silently neutralize an already-firing alert: rewriting `condition` so
 * it never evaluates true, moving `ruleGroup` into a quiet/unwatched
 * group, or stretching `for` so far the alert never has time to fire):
 *
 *  - **create**: only `isPaused` matters — a brand-new rule isn't
 *    "neutralizing" anything pre-existing; creating it paused is the only
 *    create-time signal worth flagging.
 *  - **update**: ANY of `condition`/`for`/`ruleGroup`/`isPaused` being
 *    touched is flagged — each is a way to alter whether/how an EXISTING
 *    rule fires, not just the explicit pause toggle.
 *
 * The other 3 flagged kinds (contact-point, mute-timing,
 * notification-template) are unconditionally flagged on every create AND
 * update, since roadmap/20 §In scope names the kinds themselves ("contact
 * points, mute timings, notification templates"), not a sub-field of them.
 */
const ALERT_RULE_FIRING_BEHAVIOR_UPDATE_FIELDS = [
  "condition",
  "for",
  "ruleGroup",
  "isPaused",
] as const;

export function requiredHighImpactFlagsFor(
  kind: GrafanaResourceKind,
  action: "create" | "update",
  input?: Readonly<Record<string, unknown>>,
): readonly HighImpactCapabilityFlag[] {
  const flag = HIGH_IMPACT_FLAG_BY_KIND[kind];
  if (flag === undefined) return [];

  if (kind === "alert-rule") {
    if (action === "create") {
      const touchesPause = input !== undefined && Object.hasOwn(input, "isPaused");
      return touchesPause ? [flag] : [];
    }
    const touchesFiringBehavior =
      input !== undefined &&
      ALERT_RULE_FIRING_BEHAVIOR_UPDATE_FIELDS.some((key) => Object.hasOwn(input, key));
    return touchesFiringBehavior ? [flag] : [];
  }

  return [flag];
}
