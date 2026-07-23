/**
 * Test-support only: generates a disposable self-signed TLS certificate
 * via the system `openssl` CLI, for the "custom CA honored against a
 * disposable self-signed test server" exit criterion (roadmap/16-gateway-
 * core.md §Test plan, Security). Not part of this package's public
 * surface — imported only by this package's own `.test.ts` files.
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
  const dir = await mkdtemp(join(tmpdir(), "eo-gateway-selfsigned-"));
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
