import { z } from "zod";

/**
 * `HighImpactCapabilityFlag` (roadmap/02 work item 7; interface-ledger Gap
 * 10): an 11-member closed union. Labels are provider-neutral and must be
 * cited byte-identically by every consumer (18: 7 Jira members; 20: 4
 * Grafana members) — a connector may gloss a label in its own prose (e.g.
 * "closing transitions (Jira Done/Closed statuses)") but must never rename
 * the member/label token itself.
 */
export const HIGH_IMPACT_CAPABILITY_FLAGS = [
  "assignment",
  "reporter change",
  "closing transitions",
  "sprint completion",
  "attachments",
  "bulk mutations",
  "issue creation",
  "alert disabling",
  "contact points",
  "mute timings",
  "notification templates",
] as const;

export const HighImpactCapabilityFlagSchema = z.enum(HIGH_IMPACT_CAPABILITY_FLAGS);
export type HighImpactCapabilityFlag = z.infer<typeof HighImpactCapabilityFlagSchema>;
