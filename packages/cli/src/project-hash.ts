/**
 * Provisional project-hash derivation. NO roadmap phase has yet assigned
 * ownership of "how a project hash is derived" — `@eo/journal`'s own
 * layout module says so explicitly ("this package does not define how a
 * project hash is derived... both simply consume it as a parameter").
 * Until some later phase claims that ownership, this package derives one
 * deterministically from the resolved project root path (sha256, first 16
 * hex chars) purely so its own real (non-stub) commands — `doctor`,
 * `evidence`, the XDG-permission check — have a concrete path to operate
 * against. Documented as a deviation in `docs/evidence/phase-09/`; a real
 * cross-phase resolution should replace this the moment one lands.
 */
import { createHash } from "node:crypto";

export function deriveProjectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
}
