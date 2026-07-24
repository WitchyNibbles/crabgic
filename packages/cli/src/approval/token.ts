/**
 * Approval-token minting primitive — RELOCATED to `@eo/contracts`
 * (2026-07-25) and re-exported here verbatim.
 *
 * The implementation now lives at `packages/contracts/src/approval/token.ts`;
 * see that file's own doc comment for the roadmap/09 provenance and for why
 * it had to move (phase 12's `packages/detect` is a sanctioned writer of
 * `approval_token_mint` and must mint against this exact primitive, but
 * reaching it from here closed a `cli -> learning -> gates -> detect -> cli`
 * dependency cycle that made `tsc -b` fail from a clean checkout).
 *
 * This module is kept as a named re-export so that (a) every existing
 * `./token.js` / `../approval/token.js` import inside this package keeps
 * resolving unchanged, and (b) the published `engineering-orchestrator`
 * surface is byte-for-byte the same — `../index.ts` still re-exports this
 * path. Nothing new is declared here.
 */
export {
  ApprovalTokenAlreadyVerifiedError,
  ApprovalTokenExpiredError,
  ApprovalTokenMinter,
  ApprovalTokenMismatchError,
  ApprovalTokenSignatureError,
  verifySignature,
} from "@eo/contracts";
export type {
  ApprovalTokenMinterOptions,
  ApprovalTokenMintSink,
  ApprovalTokenSubjectKind,
  ApprovalTokenVerifyExpectation,
  MintedApprovalToken,
  TokenPayload,
} from "@eo/contracts";
