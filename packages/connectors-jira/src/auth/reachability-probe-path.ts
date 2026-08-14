import { JIRA_PROVIDER_NAME } from "../errors/jira-error-mapping.js";

/**
 * The path `connection doctor` GETs to decide a Jira Cloud connection is
 * reachable — issue #135, defect 1.
 *
 * WHY NOT THE SITE ROOT. `probeConnectionReachability`'s provider-neutral
 * default is `/`, and on Atlassian Cloud an unauthenticated GET of the
 * site root redirects twice:
 *
 *   /  ->  /login.jsp?os_destination=...       (same origin, allowed)
 *      ->  https://id.atlassian.com/login?...  (cross origin, REFUSED)
 *
 * so the SSRF guard refused every Atlassian Cloud connection before any
 * other check could run, and `connection doctor` reported UNREACHABLE for
 * sites that were fine.
 *
 * `/status` is same-origin, needs no credential, and does not redirect —
 * strictly narrower than the alternative of allowlisting `id.atlassian.com`,
 * which would let a doctor probe follow redirects toward a LOGIN host. It
 * relaxes no guard: the allowlist, scheme check, DNS pinning and redirect
 * policy are all untouched by this constant; only the requested path
 * changes.
 *
 * ENGINE FACT, with its evidence. Verified unauthenticated against a live
 * Atlassian Cloud site in the issue #135 report:
 *   GET https://<site>.atlassian.net/       -> 302, chain ends cross-origin
 *   GET https://<site>.atlassian.net/status -> 200 {"state":"RUNNING"}
 * Atlassian can move it; a 404 here is now reported as UNREACHABLE naming
 * the path (see `probeConnectionReachability`), which is the signal to
 * re-verify rather than a silent pass.
 *
 * DATA CENTER IS DELIBERATELY NOT INCLUDED. Jira DC serves a `/status`
 * too, but no DC evidence was gathered, DC roots are not observed to
 * redirect off-origin, and DC sites are commonly served under a context
 * path. Guessing here would trade a verified fix for an unverified one.
 */
export const JIRA_CLOUD_REACHABILITY_PROBE_PATH = "/status";

/**
 * The provider-dispatch keys this connector claims a probe path for. Keyed
 * by the SAME constant the provider registry is keyed by, so a rename
 * cannot leave the probe pointing at a key nothing dispatches under.
 */
export const JIRA_REACHABILITY_PROBE_PATHS: Readonly<Record<string, string>> = {
  [JIRA_PROVIDER_NAME]: JIRA_CLOUD_REACHABILITY_PROBE_PATH,
};
