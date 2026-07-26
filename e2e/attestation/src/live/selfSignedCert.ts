import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Test-support only: a disposable self-signed TLS certificate via the system
 * `openssl` CLI. A package-local duplicate of the SAME small helper that
 * already exists twice in this repo — `packages/gateway/src/transport/
 * test-support/self-signed-cert.ts` and `packages/connectors-jira/src/
 * testkit/self-signed-cert.ts` — neither of which is exported from its
 * package's public barrel, so neither can be imported here. Not a divergent
 * reimplementation; the same recipe, same flags, same lifetime.
 *
 * Used by `./tlsFrontedContainer.ts` to front a containerized Grafana with
 * real TLS, because `ExternalConnection.baseUrl` is `https://`-only
 * (`external-connection.ts:76-79`) and that refinement is NOT relaxed for
 * this run.
 */
export interface DisposableCert {
  readonly keyPem: string;
  readonly certPem: string;
  /** On-disk path of the cert, for `ExternalConnection.customCaRef`. */
  readonly certPath: string;
  cleanup(): Promise<void>;
}

export async function generateSelfSignedCert(): Promise<DisposableCert> {
  const dir = await mkdtemp(join(tmpdir(), "eo-attestation-selfsigned-"));
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
    certPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
