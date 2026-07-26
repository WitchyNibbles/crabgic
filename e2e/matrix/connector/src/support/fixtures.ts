/**
 * Shared, SYNTHETIC fixture data for this harness — never a real secret,
 * never a real domain-spoofing payload sent anywhere; every value below is
 * either a well-known sentinel shape (matching `@crabgic/renderer`'s
 * `secretScanStage` patterns) or built from explicit Unicode codepoints
 * (never a literal non-ASCII glyph typed into source, matching
 * `@crabgic/renderer/src/unicode-defense.ts`'s own documented convention — "never
 * a literal invisible glyph in source").
 */

/**
 * AWS-style access key sentinel — `AKIA` + exactly 16 uppercase
 * alphanumerics, matching `@crabgic/renderer`'s `AKIA[0-9A-Z]{16}` pattern
 * exactly. A synthetic, never-issued sentinel — this is NOT a real AWS key
 * (real AWS access keys are also `AKIA` + 16 chars, but this exact string
 * is deliberately alphabetic-sequential, a shape no real key generator
 * produces).
 */
export const SYNTHETIC_AWS_ACCESS_KEY = "AKIAABCDEFGHIJKLMNOP";

/**
 * Anthropic-style API key sentinel — `sk-ant-` + >=10 alphanumerics/
 * hyphens, matching `@crabgic/renderer`'s `sk-ant-[A-Za-z0-9-]{10,}` pattern.
 * Deliberately reads as "should never appear in real output" — a synthetic
 * sentinel, never a real credential.
 */
export const SYNTHETIC_ANTHROPIC_KEY = "sk-ant-shouldnotappearsentinel1234567890";

/** A GitHub-style PAT sentinel — matches `gh[pousr]_[A-Za-z0-9]{36}`. */
export const SYNTHETIC_GITHUB_PAT = `ghp_${"S".repeat(36)}`;

/**
 * A confusable/homograph domain — built from explicit `String.fromCodePoint`
 * calls (never a literal non-ASCII glyph in source, mirroring
 * `@crabgic/renderer/src/unicode-defense.ts`'s own convention for its curated
 * confusable table), so the exact codepoint is unambiguous on inspection.
 * `CYRILLIC_SMALL_LETTER_A` (U+0430) replaces the first Latin "a" in
 * "paypal.com" — the classic homograph-phishing shape
 * (`@crabgic/renderer/src/unicode-defense.ts`'s own CONFUSABLE_ENTRIES table
 * entry `[0x0430, "a", "CYRILLIC SMALL LETTER A"]`).
 */
const CYRILLIC_SMALL_LETTER_A = String.fromCodePoint(0x0430);
export const CONFUSABLE_DOMAIN_HOST = `p${CYRILLIC_SMALL_LETTER_A}ypal.com`;
export const CONFUSABLE_DOMAIN_URL = `https://${CONFUSABLE_DOMAIN_HOST}/reset-password`;

/** The genuine, non-confusable Latin domain the above spoofs — used as the "this must NOT be flagged" control fixture. */
export const BENIGN_DOMAIN_URL = "https://paypal.com/reset-password";
