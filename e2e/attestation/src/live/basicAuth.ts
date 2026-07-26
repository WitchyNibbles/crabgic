/**
 * The one credential-shaping step of the containerized traceability binding,
 * split out of `./grafanaTraceabilityBinding.ts` so it is unit-testable
 * WITHOUT a Docker daemon.
 *
 * WHY THIS EXISTS AT ALL (adversarial-validation MINOR-6): the binding
 * harness used to hardcode `Basic ${base64("admin:admin")}` inline while the
 * `ExternalConnection` it built declared a `secretRef` that nothing ever
 * read — so the run advertised a credential-resolution path it did not take.
 * The credential is now resolved through `@crabgic/gateway`'s real
 * `resolveSecretReference` against that declared `secretRef`, and this module
 * holds the only part of that path with no I/O in it.
 *
 * The credential itself is Grafana OSS's container-local admin, set by each
 * `docker/grafana/<version>/docker-compose.yml`'s `GF_SECURITY_ADMIN_PASSWORD`
 * — disposable, reachable only on loopback, and torn down with the container.
 */

/** `user:password`, exactly as RFC 7617 defines the userid-password token. */
export function buildBasicAuthHeader(credential: string): string {
  const trimmed = credential.trim();
  if (trimmed.length === 0) {
    throw new Error("basic auth: resolved credential is empty");
  }
  if (!trimmed.includes(":")) {
    throw new Error(
      'basic auth: resolved credential is not in "user:password" form (no ":" separator) — ' +
        "refusing to send a half-formed Authorization header",
    );
  }
  return `Basic ${Buffer.from(trimmed).toString("base64")}`;
}
