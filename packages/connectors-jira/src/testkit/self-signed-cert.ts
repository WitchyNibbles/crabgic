/**
 * Test-support only: generates a disposable self-signed TLS certificate
 * via the system `openssl` CLI — mirrors `@eo/gateway`'s own internal
 * `transport/test-support/self-signed-cert.ts` (not part of that
 * package's public barrel, so it cannot be imported here; this is a
 * package-local duplicate of the SAME small helper, not a divergent
 * reimplementation). Used by
 * `./custom-ca-self-signed.integration.test.ts` for roadmap/19-jira-
 * datacenter-adapter.md's "custom-CA/self-signed connection succeeds
 * against a disposable self-signed test server" exit criterion.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DisposableCert {
  readonly keyPem: string;
  readonly certPem: string;
  cleanup(): Promise<void>;
}

/** Generates a fresh, disposable self-signed cert (CN=localhost) valid for 1 day, via `openssl req -x509`. */
export async function generateSelfSignedCert(): Promise<DisposableCert> {
  const dir = await mkdtemp(join(tmpdir(), "eo-connectors-jira-selfsigned-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");

  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);

  const [keyPem, certPem] = await Promise.all([
    readFile(keyPath, "utf8"),
    readFile(certPath, "utf8"),
  ]);

  return {
    keyPem,
    certPem,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
