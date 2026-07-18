/**
 * Branch-level coverage for `spawnAndParseJsonLine` — the generic child-
 * process-with-timeout-and-JSON-parse mechanics `readPeerCredentialsLinux`
 * is built on. Uses trivial `node -e` fixtures (always available, unlike
 * depending on `python3`'s own specific negative-path behavior) to exercise
 * every failure branch directly: timeout, non-zero exit, malformed stdout,
 * a genuinely unspawnable command (ENOENT), and the success path.
 */
import { describe, expect, it } from "vitest";
import { PeerCredentialUnavailableError, spawnAndParseJsonLine } from "./peer-credentials.js";

// Any already-open fd in THIS process works as the dup() target — none of
// these fixture scripts actually touch fd 3.
const DUMMY_FD = 1;

describe("spawnAndParseJsonLine", () => {
  it("resolves the parsed JSON on a clean exit", async () => {
    const result = await spawnAndParseJsonLine<{ ok: boolean }>(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify({ok:true}))"],
      DUMMY_FD,
      2_000,
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects with PeerCredentialUnavailableError on a non-zero exit code", async () => {
    await expect(
      spawnAndParseJsonLine(
        process.execPath,
        ["-e", "process.stderr.write('boom'); process.exit(3)"],
        DUMMY_FD,
        2_000,
      ),
    ).rejects.toBeInstanceOf(PeerCredentialUnavailableError);
  });

  it("rejects with PeerCredentialUnavailableError on malformed (non-JSON) stdout", async () => {
    await expect(
      spawnAndParseJsonLine(
        process.execPath,
        ["-e", "process.stdout.write('not json at all')"],
        DUMMY_FD,
        2_000,
      ),
    ).rejects.toBeInstanceOf(PeerCredentialUnavailableError);
  });

  it("rejects with PeerCredentialUnavailableError on a timeout (child never exits in time)", async () => {
    await expect(
      spawnAndParseJsonLine(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"], // never exits on its own
        DUMMY_FD,
        50,
      ),
    ).rejects.toBeInstanceOf(PeerCredentialUnavailableError);
  }, 5_000);

  it("rejects with PeerCredentialUnavailableError for a genuinely unspawnable command", async () => {
    await expect(
      spawnAndParseJsonLine("this-binary-does-not-exist-anywhere", [], DUMMY_FD, 2_000),
    ).rejects.toBeInstanceOf(PeerCredentialUnavailableError);
  });
});
