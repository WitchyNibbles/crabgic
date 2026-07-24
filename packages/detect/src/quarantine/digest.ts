/**
 * `computeCandidateDigest` — stage 2 (pin)'s core primitive. roadmap/12
 * §Test plan, "Conformance" bullet: "digest-pinning reproducibility: two
 * audits of a byte-identical candidate yield the identical digest." Pure,
 * deterministic sha256 over a canonical serialization: files sorted by
 * path (so file ORDER in the source descriptor never affects the digest),
 * each file's path/content/executable-bit included, plus `kind`/`name`/
 * sorted `permissionFootprint`. `provenance` is deliberately EXCLUDED from
 * the digest — it is metadata ABOUT the candidate (signature, SBOM
 * reference), not part of the candidate's own content identity; a
 * candidate re-signed with a new signature over identical file content
 * must still pin to the SAME digest.
 */
import { createHash } from "node:crypto";
import type { CandidateSource } from "./types.js";

function canonicalize(source: CandidateSource): string {
  const sortedFiles = [...source.files]
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => ({ path: f.path, content: f.content, executable: f.executable ?? false }));
  const sortedPermissions = [...source.permissionFootprint].sort();

  return JSON.stringify({
    kind: source.kind,
    name: source.name,
    files: sortedFiles,
    permissionFootprint: sortedPermissions,
  });
}

/** The content-addressed digest of `source` — `sha256:<hex>`, deterministic and order-independent. */
export function computeCandidateDigest(source: CandidateSource): string {
  const hash = createHash("sha256").update(canonicalize(source), "utf8").digest("hex");
  return `sha256:${hash}`;
}
