/**
 * Secret-reference argument type — roadmap/09-cli-and-doctor.md §Interfaces
 * produced item 5: "Secret-reference argument type + argv validation
 * (rejects literal secret values, references only)." A "reference" points
 * at where a secret lives (an env var name, a secret-manager URI); it never
 * carries the secret's own bytes. This module's job is purely
 * classification — it never resolves a reference to a real value (no
 * network/filesystem I/O here), so it can never itself leak anything.
 */
import { SecretValueRejectedError } from "../errors.js";

/** A reference form this module recognizes as safe: `env:NAME`, `op://...`, `vault://...`, `file:///abs/path` (never inlined content), or `ref:opaque-id`. */
const REFERENCE_PATTERN = /^(env:[A-Za-z_][A-Za-z0-9_]*|op:\/\/\S+|vault:\/\/\S+|file:\/\/\/\S+|ref:\S+)$/;

/**
 * Shapes commonly mistaken for "just a string" but which are actual secret
 * material: long high-entropy tokens, known provider prefixes, PEM
 * material, JWTs. This is a defense-in-depth heuristic, not a claim of
 * completeness — the primary guarantee is the allowlist above (anything
 * not matching a known reference form is rejected), this list only
 * improves the rejection *message*'s specificity.
 */
const KNOWN_SECRET_PREFIXES = [
  "sk-",
  "sk_",
  "ghp_",
  "gho_",
  "github_pat_",
  "xox",
  "AKIA",
  "-----BEGIN",
];

function looksLikeKnownSecretPrefix(value: string): boolean {
  return KNOWN_SECRET_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function looksHighEntropy(value: string): boolean {
  // A long run of mixed-case-alphanumeric-with-symbols with no whitespace is
  // consistent with a raw secret/token rather than a short human-typed
  // reference; a real reference form always matches REFERENCE_PATTERN
  // first, so this only fires for something that isn't one.
  return value.length >= 20 && !/\s/.test(value);
}

export type SecretReference = { readonly raw: string };

/**
 * Validates `value` (the raw argv string supplied for a secret-bearing
 * flag) is a reference, not a literal value. Throws `SecretValueRejectedError`
 * (never returns a partially-validated result) for anything that isn't a
 * recognized reference form. `argumentName` is only used to build the error
 * message (e.g. `--token`) — never echoed with the rejected value itself,
 * so a caller logging this error never reproduces the secret verbatim.
 */
export function parseSecretReference(argumentName: string, value: string): SecretReference {
  if (REFERENCE_PATTERN.test(value)) {
    return { raw: value };
  }
  throw new SecretValueRejectedError(argumentName);
}

/**
 * Non-throwing classifier used by this module's own property/fuzz suite
 * (`./secret-reference.property.test.ts`) to decide whether an arbitrary
 * generated token *would* be rejected, without needing to catch an
 * exception for every candidate in a large random corpus. NOT used by
 * `./parse-command.ts` itself — the parser calls `parseSecretReference`
 * directly (throw-on-reject), never this classifier (corrected 2026-07-24;
 * an earlier version of this comment claimed the parser used it).
 */
export function isSecretShapedValue(value: string): boolean {
  if (REFERENCE_PATTERN.test(value)) return false;
  return looksLikeKnownSecretPrefix(value) || looksLikeJwt(value) || looksHighEntropy(value);
}
