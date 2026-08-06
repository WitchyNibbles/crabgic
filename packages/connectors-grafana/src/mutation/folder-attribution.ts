import type { RemoteMutationPlan } from "@crabgic/contracts";
import type { MutationFolderAttribution } from "@crabgic/gateway";
import { parseCanonicalTarget } from "./canonical-target.js";
import type { GrafanaPlanPayloadStoreLike } from "./plan-payload-store.js";

/**
 * DEFECT 16 — this connector's implementation of
 * `@crabgic/gateway`'s `MutationPipelineHandlers.folderAttribution`: it
 * answers WHERE a mutation lands, in folder terms, so
 * `ExternalConnection.folderAllowlist` has something to be checked against.
 * Read that hook's own doc comment for the admission semantics; this module
 * owns only the Grafana-side mapping.
 *
 * WHY THE PAYLOAD STORE. `RemoteMutationPlan` carries a desired-state HASH,
 * never the body (`@crabgic/contracts`' `remote-mutation-plan.ts`), so the
 * folder is not on the plan. `planCreate`/`planUpdate` stash the real input
 * in `./plan-payload-store.js` and `./mutation-apply-client.js` already
 * resolves it back the same way to build the request — this reuses that
 * seam rather than adding a second one. The lookup is synchronous and
 * performs no I/O, which the hook's purity requirement demands.
 *
 * PER-KIND RULING, over the closed 7-kind list in `../resource-kinds.ts`,
 * each derived from that kind's own `CANONICAL_FIELD_KEYS` rather than
 * guessed:
 *
 *  - `folder` — the resource IS a folder, so a write to it is a write in
 *    that folder; the id is on the canonical target and no payload is
 *    needed. (Deliberately NOT its `parentUid`: an operator allowlisting
 *    `team-a` means "you may write team-a", and reading the parent instead
 *    would refuse renaming an explicitly-allowlisted root folder.)
 *  - `dashboard` — `folderUid` (`../resources/definitions/dashboard.ts`).
 *  - `alert-rule` — `folderUID`, capital-UID
 *    (`../resources/definitions/alert-rule.ts`). The two spellings are a
 *    real Grafana API difference, not a typo, and reading the wrong one
 *    would silently refuse every write on a folder-scoped connection.
 *  - `annotation` — `unknown`. Its canonical fields name a `dashboardUID`,
 *    never a folder, so placing it needs a remote read this hook may not do.
 *  - `contact-point`, `mute-timing`, `notification-template` —
 *    `outside-folders`. These are org-level in Grafana's own model; there
 *    is no folder to be in.
 *
 * `outside-folders` VS `unknown` — both are refused under a declared
 * allowlist, so the distinction is not about the verdict. It is about what
 * the operator is told, and about not lying: `outside-folders` is a
 * POSITIVE claim that the resource lives in no folder (Grafana's classic
 * API literally returns `{"folderUid":""}` for a root dashboard), while
 * `unknown` says this connector could not tell. Collapsing them would make
 * a lost payload-store entry indistinguishable from a genuine root-level
 * write.
 *
 * A malformed or unrecognized canonical target answers `unknown` rather
 * than throwing: this runs ahead of all I/O and outside any try/catch of
 * the pipeline's, so a throw would escape `executeMutationPlan` as an
 * unexpected error instead of the typed refusal an operator should see.
 */
export function grafanaFolderAttribution(
  plan: RemoteMutationPlan,
  payloadStore: GrafanaPlanPayloadStoreLike,
): MutationFolderAttribution {
  let kind: string;
  let id: string;
  try {
    ({ kind, id } = parseCanonicalTarget(plan.canonicalTarget));
  } catch {
    return { scope: "unknown" };
  }

  if (kind === "folder") return { scope: "folders", folders: [id] };
  if (kind === "contact-point" || kind === "mute-timing" || kind === "notification-template") {
    return { scope: "outside-folders" };
  }
  if (kind === "annotation") return { scope: "unknown" };

  const input = payloadStore.get(plan.id)?.input;
  if (input === undefined) return { scope: "unknown" };

  if (kind === "dashboard") {
    const folderUid = input["folderUid"];
    // A root dashboard is `""` on the wire — a positive "no folder", not
    // missing data. Anything non-string is neither, and is not coerced.
    if (folderUid === undefined || folderUid === "") return { scope: "outside-folders" };
    if (typeof folderUid !== "string") return { scope: "unknown" };
    return { scope: "folders", folders: [folderUid] };
  }

  // `alert-rule`, the only remaining kind. A Grafana alert rule always
  // belongs to a folder, so an absent `folderUID` is missing data
  // (`unknown`), never a positive claim of root placement.
  const folderUid = input["folderUID"];
  if (typeof folderUid !== "string" || folderUid.length === 0) return { scope: "unknown" };
  return { scope: "folders", folders: [folderUid] };
}
