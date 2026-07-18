/**
 * ndjson wire-message codec — mirrors `@eo/journal`'s
 * `codec/ndjson-codec.ts` style: encode/decode against a single top-level
 * schema (`WireMessageSchema` here, `JournalEntrySchema` there), a
 * throwing `decodeLine` and a tolerant `tryDecodeLine`.
 */

import { WireMessageSchema, type WireMessage } from "./wire-schema.js";

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Serializes one `WireMessage` to its ndjson line form (a single JSON object, newline-terminated). */
export function encodeMessageToLine(message: WireMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export interface DecodeMessageResult {
  readonly ok: boolean;
  readonly message?: WireMessage;
  readonly error?: string;
}

/** Parses and validates one ndjson line (without its trailing newline) as a `WireMessage`. Throws on failure. */
export function decodeMessageLine(line: string): WireMessage {
  const parsed: unknown = JSON.parse(line);
  return WireMessageSchema.parse(parsed);
}

/** Tolerant variant — never throws, reports failure via the returned result. */
export function tryDecodeMessageLine(line: string): DecodeMessageResult {
  try {
    return { ok: true, message: decodeMessageLine(line) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}
