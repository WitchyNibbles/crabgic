#!/usr/bin/env node
/**
 * Resolves every `ci-run` citation in the criteria-closeout index against the
 * GitHub Actions API, so a cited run has to actually exist.
 *
 *   npm run check:citation-runs        (a `meta-checks` step; needs GITHUB_TOKEN)
 *
 * WHY THIS EXISTS, separately from `check-criteria-closeout.mjs`. That check is
 * offline and dependency-free by design, so the strongest thing it can say
 * about a `ci-run` citation is that it *names* a run in this repository. An
 * adversarial review showed why that is not enough: a reviewer generated a
 * whole `phase-13.json` from the real checkbox texts — so every frozen baseline
 * hash matched — classified all seven criteria `EVIDENCE-EXISTS`, cited each
 * one with `job 00000000000` / `runs/1`, ticked the boxes, and got a green
 * validator, a green baseline `--check`, and green CI. A wholly forged phase
 * closeout, with nothing behind it. `ci-run` was the last citation kind where
 * NOTHING had to exist; this is the half that makes it exist.
 *
 * EXISTENCE WAS NOT ENOUGH EITHER — round-8 finding (bypass 17b), demonstrated
 * live. A reviewer repointed phase 01's criterion 1 at run 30250453824: a
 * months-old `release-e2e` run, wrong workflow, wrong commit, predating the
 * criterion. They set the citation's `commit` to the null object id and
 * fabricated the `quotedAssertion`. The offline validator reported zero errors
 * and this check would have passed too — the run is real, so the 404 probe was
 * satisfied, and nothing anywhere read `commit`. Any real run in this
 * repository's history could stand as evidence for any criterion at any claimed
 * commit. Both `/actions/runs/<id>` and `/actions/jobs/<id>` carry `head_sha`,
 * and the job form carries `workflow_name`, so the citation's two provenance
 * claims are checkable with the request this check already makes.
 *
 * FAILURE SEMANTICS, deliberately asymmetric. Only a definitive negative fails
 * the build: a 404 for a cited run means the run is not there, and a `head_sha`
 * or workflow name that DISAGREES with the citation means the citation is
 * wrong. Anything that merely means "we could not ask" — no token, rate
 * limiting, a 5xx, DNS, or a response that simply does not carry the field —
 * warns and exits 0, because a GitHub API blip must not red an honest PR. That
 * asymmetry is the whole design: it cannot be turned into a bypass, since an
 * attacker can make the API return neither 404-shaped success nor a matching
 * `head_sha` for a run that ran somewhere else.
 *
 * DELIBERATELY NOT CHECKED: `conclusion == "success"`. A record may legitimately
 * cite a RED run — phase 01's closeout does exactly that, citing runs that
 * failed on purpose as evidence that a gate really bites. Requiring success
 * would reject the most honest records in the index.
 *
 * Dependency-free: `fetch` is built into Node 24, which is what `meta-checks`
 * runs. The pure part is `auditCiRunCitations`, which takes its resolver as an
 * argument and is unit-tested against a fake in `check-citation-runs.test.mjs`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLOSEOUT_DIR, ciRunRefLead, ciRunRefNamesWorkflow } from "./check-criteria-closeout.mjs";

export const REPO_SLUG = "WitchyNibbles/crabgic";

/**
 * `…/actions/runs/<id>`, `…/actions/runs/<id>/job/<jid>` and
 * `…/actions/jobs/<jid>` are all in use across the committed records.
 * The run form and the job form hit different API endpoints.
 */
export function parseActionsUrl(url) {
  const run = new RegExp(
    `^https://github\\.com/${REPO_SLUG}/actions/runs/(\\d+)(?:/job/\\d+)?$`,
  ).exec(url);
  if (run !== null) return { kind: "run", id: run[1] };
  const job = new RegExp(`^https://github\\.com/${REPO_SLUG}/actions/jobs/(\\d+)$`).exec(url);
  if (job !== null) return { kind: "job", id: job[1] };
  return undefined;
}

export const apiPathFor = ({ kind, id }) =>
  `/repos/${REPO_SLUG}/actions/${kind === "run" ? "runs" : "jobs"}/${id}`;

/**
 * Holds a resolved run's provenance against what the citation claims about it.
 * A DISAGREEMENT is definite and errors; a field the API did not carry is a
 * "could not ask" and warns, keeping the asymmetry intact.
 */
function auditProvenance({ errors, warnings }, where, citation, outcome) {
  let commitChecked = false;
  let commitVerified = false;

  const claimed = typeof citation.commit === "string" ? citation.commit.trim().toLowerCase() : "";
  if (claimed.length > 0) {
    commitChecked = true;
    const headSha = typeof outcome.headSha === "string" ? outcome.headSha.toLowerCase() : "";
    if (headSha.length === 0) {
      warnings.push(
        `${where}: ${citation.url} resolved, but the response carried no head_sha, so the cited commit ${claimed} is unverified`,
      );
    } else if (!headSha.startsWith(claimed)) {
      errors.push(
        `${where}: cites commit ${claimed}, but ${citation.url} ran at ${headSha} — a real run of this repository cited at a commit it never touched is how ANY run is made to stand as evidence for ANY criterion`,
      );
    } else {
      commitVerified = true;
    }
  }

  const actual = typeof outcome.workflowName === "string" ? outcome.workflowName.trim() : "";
  if (actual.length > 0 && ciRunRefNamesWorkflow(citation.ref, actual) === false) {
    errors.push(
      `${where}: the ref leads with ${JSON.stringify(ciRunRefLead(citation.ref))}, but ${citation.url} is a run of workflow ${JSON.stringify(actual)} — the citation and the run it resolves to are not describing the same thing`,
    );
  }

  return { commitChecked, commitVerified };
}

/**
 * @param {{fileName: string, record: object}[]} records
 * @param {(target: {kind: string, id: string}) => Promise<{found: boolean, unavailable?: string, headSha?: string, workflowName?: string}>} resolve
 * @returns {Promise<{errors: string[], warnings: string[], checked: number, verified: number, commitsChecked: number, commitsVerified: number}>}
 */
export async function auditCiRunCitations(records, resolve) {
  const errors = [];
  const warnings = [];
  const cache = new Map();
  let checked = 0;
  let verified = 0;
  let commitsChecked = 0;
  let commitsVerified = 0;

  for (const { fileName, record } of records) {
    const criteria = Array.isArray(record?.criteria) ? record.criteria : [];
    for (const [position, criterion] of criteria.entries()) {
      const citations = Array.isArray(criterion?.citations) ? criterion.citations : [];
      for (const [index, citation] of citations.entries()) {
        if (citation?.kind !== "ci-run") continue;
        const where = `${fileName} criteria[${String(position)}].citations[${String(index)}]`;
        const target = typeof citation.url === "string" ? parseActionsUrl(citation.url) : undefined;
        if (target === undefined) {
          // The offline validator already reports this; nothing to resolve.
          continue;
        }
        const key = `${target.kind}:${target.id}`;
        if (!cache.has(key)) cache.set(key, await resolve(target));
        const outcome = cache.get(key);
        checked += 1;
        if (outcome.unavailable !== undefined) {
          warnings.push(`${where}: could not resolve ${citation.url} — ${outcome.unavailable}`);
        } else if (outcome.found) {
          verified += 1;
          // Existence alone let a months-old run of the wrong workflow, at a
          // fabricated commit, stand as a criterion's evidence. See bypass 17b.
          const provenance = auditProvenance({ errors, warnings }, where, citation, outcome);
          if (provenance.commitChecked) commitsChecked += 1;
          if (provenance.commitVerified) commitsVerified += 1;
        } else {
          errors.push(
            `${where}: ${citation.url} does not exist in ${REPO_SLUG}'s Actions history — a cited run that is not there is a fabricated citation`,
          );
        }
      }
    }
  }
  return { errors, warnings, checked, verified, commitsChecked, commitsVerified };
}

/**
 * The real resolver. Distinguishes "not there" (404) from "could not ask"
 * (everything else), and carries back the run's provenance so a citation can be
 * held against it.
 *
 * `head_sha` is on both endpoints. The workflow name is `workflow_name` on a
 * job and `name` on a run (a run's `name` is its workflow's name unless the
 * workflow sets `run-name:`, which none in this repository does); a body that
 * carries neither simply leaves the field undefined, which warns rather than
 * fails.
 */
function githubResolver(token) {
  return async (target) => {
    let response;
    try {
      response = await fetch(`https://api.github.com${apiPathFor(target)}`, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "crabgic-criteria-closeout",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
      });
    } catch (cause) {
      return { found: false, unavailable: `network error: ${String(cause)}` };
    }
    if (response.status === 404) return { found: false };
    if (response.ok) {
      let body;
      try {
        body = await response.json();
      } catch {
        // A body we cannot read is "could not ask" about provenance, not a
        // mismatch — the run itself resolved.
        return { found: true };
      }
      const workflowName =
        typeof body?.workflow_name === "string"
          ? body.workflow_name
          : typeof body?.name === "string"
            ? body.name
            : undefined;
      return {
        found: true,
        headSha: typeof body?.head_sha === "string" ? body.head_sha : undefined,
        workflowName,
      };
    }
    return { found: false, unavailable: `HTTP ${String(response.status)}` };
  };
}

function readRecords(repoRoot) {
  const dir = path.join(repoRoot, CLOSEOUT_DIR);
  return readdirSync(dir)
    .filter((name) => /^phase-\d{2}\.json$/.test(name))
    .sort()
    .map((fileName) => ({
      fileName,
      record: JSON.parse(readFileSync(path.join(dir, fileName), "utf8")),
    }));
}

async function main() {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token === undefined) {
    console.warn(
      "check-citation-runs: no GITHUB_TOKEN — skipping (unauthenticated requests are rate-limited to the point of uselessness). This check is meaningful in CI.",
    );
    return;
  }
  const { errors, warnings, checked, verified, commitsChecked, commitsVerified } =
    await auditCiRunCitations(readRecords(repoRoot), githubResolver(token));
  for (const warning of warnings) console.warn(`check-citation-runs: WARN ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`check-citation-runs: ${error}`);
    console.error(`check-citation-runs: FAIL — ${String(errors.length)} fabricated citation(s).`);
    process.exit(1);
  }
  // A dead check reporting PASS is the exact failure mode this whole effort
  // exists to prevent. Tolerating individual unresolvable citations is the
  // intended asymmetry; resolving NONE of them means the check has silently
  // stopped working — a bad token, a blocked network — and it must say so
  // rather than print a green line it has not earned.
  if (checked > 0 && verified === 0) {
    console.error(
      `check-citation-runs: FAIL — verified NOTHING: all ${String(checked)} ci-run citation(s) were unresolvable, so this check proved nothing. Fix the token or the network rather than reading this as a pass.`,
    );
    process.exit(1);
  }
  // The same guard for the provenance half. Existence resolving while every
  // head_sha comparison silently declines to happen would leave bypass 17b
  // wide open under a green PASS line.
  if (commitsChecked > 0 && commitsVerified === 0) {
    console.error(
      `check-citation-runs: FAIL — resolved ${String(verified)} run(s) but confirmed NOT ONE of ${String(commitsChecked)} cited commit(s) against a head_sha, so the provenance half of this check proved nothing. A cited run existing does not make it the run that evidences the criterion.`,
    );
    process.exit(1);
  }
  console.log(
    `check-citation-runs: PASS — ${String(verified)}/${String(checked)} ci-run citation(s) resolve to real runs, ${String(commitsVerified)}/${String(commitsChecked)} at the commit they cite${warnings.length > 0 ? `, ${String(warnings.length)} unresolvable (tolerated)` : ""}.`,
  );
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
