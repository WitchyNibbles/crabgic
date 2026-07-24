import type { GrafanaResourceKind } from "../../resource-kinds.js";
import type { GrafanaResourceDefinition } from "../resource-definitions.js";
import { alertRuleDefinition } from "./alert-rule.js";
import { annotationDefinition } from "./annotation.js";
import { contactPointDefinition } from "./contact-point.js";
import { dashboardDefinition } from "./dashboard.js";
import { folderDefinition } from "./folder.js";
import { muteTimingDefinition } from "./mute-timing.js";
import { notificationTemplateDefinition } from "./notification-template.js";

/** The registry backing `GrafanaProviderAdapter` — one `GrafanaResourceDefinition` per one of the 7 in-scope kinds, no more, no fewer (proved by `resource-client.test.ts`'s "registry covers every declared kind" test). */
export const GRAFANA_RESOURCE_DEFINITIONS: Readonly<
  Record<GrafanaResourceKind, GrafanaResourceDefinition>
> = {
  folder: folderDefinition,
  dashboard: dashboardDefinition,
  annotation: annotationDefinition,
  "alert-rule": alertRuleDefinition,
  "contact-point": contactPointDefinition,
  "mute-timing": muteTimingDefinition,
  "notification-template": notificationTemplateDefinition,
};

export function getResourceDefinition(kind: GrafanaResourceKind): GrafanaResourceDefinition {
  return GRAFANA_RESOURCE_DEFINITIONS[kind];
}
