/**
 * Pure ndjson line framer — buffers arbitrarily-chunked bytes from a
 * socket's `data` events and yields exactly the complete (newline-
 * terminated) lines available so far, holding back any trailing partial
 * line for the next `push()` call. No I/O of its own — a raw `net.Socket`
 * caller feeds it chunks; kept pure/synchronous so it is directly
 * unit-testable without a real socket.
 *
 * Bounded by `MAX_LINE_BYTES`: an admitted (same-uid, already-trusted)
 * peer is still an unbounded input source — a newline-less multi-GB
 * stream from it would otherwise buffer without limit and OOM the host.
 * `push()` throws `LineTooLongError` the instant either (a) the buffered,
 * not-yet-newline-terminated remainder, or (b) any single completed line,
 * exceeds the cap — whichever is caught first. The caller (`../socket/
 * uds-server.ts`) treats this as a protocol violation and destroys the
 * connection rather than buffering further.
 */
import { StringDecoder } from "node:string_decoder";

export interface LineFramer {
  /** Feed one raw chunk; returns zero or more newly-complete lines (each WITHOUT its trailing `\n`). Throws `LineTooLongError` if the cap is exceeded. */
  push(chunk: Buffer | string): readonly string[];
  /** Whatever partial (non-newline-terminated) text remains buffered. Excludes the at-most-3 bytes of an incomplete UTF-8 sequence the decoder is still holding — those are not yet text. */
  readonly pending: string;
}

/**
 * 1 MiB — matches the ring buffer's own capacity scale
 * (`RING_BUFFER_CAPACITY_BYTES`, ../event-bus/ring-buffer.ts): generous
 * headroom for any legitimate ndjson handshake/request/response line (the
 * wire protocol's own messages are small, structured JSON — see
 * `./wire-schema.ts`), while bounding how far a same-uid, already-trusted
 * but potentially misbehaving peer can grow this buffer before the
 * connection is torn down.
 */
export const MAX_LINE_BYTES = 1024 * 1024;

export class LineTooLongError extends Error {
  constructor(byteLength: number) {
    super(
      `supervisor: unframed line exceeded ${String(MAX_LINE_BYTES)} bytes ` +
        `(buffered ${String(byteLength)} bytes) with no newline`,
    );
    this.name = "LineTooLongError";
  }
}

export function createLineFramer(): LineFramer {
  let buffer = "";
  /**
   * A socket delivers chunks at arbitrary BYTE boundaries, never character
   * boundaries. `chunk.toString("utf8")` per chunk decodes a multi-byte
   * sequence split across two chunks to U+FFFD on BOTH sides, so the framed
   * line differs from the bytes the peer sent — and because the damage stays
   * inside a JSON string, `JSON.parse` then succeeds on corrupted text rather
   * than failing, which is the worse of the two outcomes. `StringDecoder`
   * holds back the incomplete tail (at most 3 bytes) and emits it together
   * with the bytes that complete it on the next `write`.
   *
   * String chunks go through the same decoder rather than being appended
   * directly: appending one while the decoder still holds a partial sequence
   * would put it AHEAD of the bytes that complete that character.
   */
  const decoder = new StringDecoder("utf8");
  return {
    push(chunk: Buffer | string): readonly string[] {
      buffer += decoder.write(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      const lines: string[] = [];
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const candidate = buffer.slice(0, newlineIndex);
        const candidateBytes = Buffer.byteLength(candidate, "utf8");
        if (candidateBytes > MAX_LINE_BYTES) {
          throw new LineTooLongError(candidateBytes);
        }
        lines.push(candidate);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
      const pendingBytes = Buffer.byteLength(buffer, "utf8");
      if (pendingBytes > MAX_LINE_BYTES) {
        throw new LineTooLongError(pendingBytes);
      }
      return lines;
    },
    get pending(): string {
      return buffer;
    },
  };
}
