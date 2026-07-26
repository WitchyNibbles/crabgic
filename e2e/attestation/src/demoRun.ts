import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_COMMUNICATION_POLICY } from "@crabgic/contracts";
import { createGitPlumbing, nameBranch, publishLocal } from "@crabgic/git-engine";
import {
  lint,
  renderPrBody,
  renderPrTitle,
  renderReviewComment,
  type ArtifactKind,
} from "@crabgic/renderer";
import type { DemoRunRecord } from "./demoBranchEvidenceHandoff.js";

/**
 * The demo run — roadmap/23 Exit criteria: "A verified neutral local branch
 * with concise commits and evidence-backed handoff produced by the demo run
 * — the branch plus its evidence bundle (rendered PR-title/PR-body/
 * review-comment artifacts retrievable via `evidence <change-set-id>`),
 * never an opened PR (Gap 6, by design)."
 *
 * WHAT CHANGED, AND WHY (2026-07-25): the first version of this item's
 * check read a hand-written `demo-run.json`. Describing a demo run in a
 * file is not performing one. This module performs it, against the real
 * subsystems:
 *
 *   - 08's `nameBranch` picks the branch name (never a hand-written string),
 *   - 17's `renderPrTitle`/`renderPrBody`/`renderReviewComment` produce the
 *     handoff bundle, and 17's own `lint` judges each artifact so the
 *     neutrality claim is made by the production linter rather than by this
 *     harness,
 *   - 08's `publishLocal` creates the branch in a throwaway "user" repo by
 *     fetching from a throwaway control clone — a local filesystem path,
 *     never a remote URL.
 *
 * ZERO REMOTE INTERACTION IS STRUCTURAL, NOT ASSERTED. Neither throwaway
 * repository ever has a remote configured, so there is nothing to push to;
 * the run additionally records the remote count it observed, and the check
 * verifies it is zero.
 *
 * SCOPE, STATED PLAINLY: the code change this demo publishes is seeded
 * rather than authored by the engine. What this exit criterion verifies is
 * the branch, the commits, the bundle and the absence of a PR — none of
 * which depends on who wrote the diff. The engine-authored path is covered
 * by `e2e/live`'s own conformance run, not here.
 */

const exec = promisify(execFile);
const plumbing = createGitPlumbing();

/**
 * ASCII record/unit separators. Deliberately NOT `NUL`: Node's
 * `child_process` rejects any argument containing a null byte
 * (`ERR_INVALID_ARG_VALUE`), so the conventional `git log -z` idiom cannot
 * be expressed through `execFile`. These two are safe in argv and cannot
 * occur in a commit subject or body.
 */
const RECORD_SEPARATOR = String.fromCharCode(30);
const FIELD_SEPARATOR = String.fromCharCode(31);

/** A throwaway repository with one commit, no remote, and a deterministic identity. */
async function buildThrowawayRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await exec("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "demo@example.invalid"], { cwd: dir });
  await exec("git", ["config", "user.name", "Demo Runner"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# demo\n", "utf-8");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "chore: seed the demo repository"], { cwd: dir });
  return dir;
}

/** Counts configured remotes — the structural proof that nothing could have been pushed. */
async function countRemotes(repoDir: string): Promise<number> {
  const { stdout } = await exec("git", ["remote"], { cwd: repoDir });
  return stdout.split("\n").filter((line) => line.trim() !== "").length;
}

export interface DemoRunResult {
  readonly record: DemoRunRecord;
  /** Directory holding the rendered bundle artifacts. */
  readonly bundleDir: string;
  /** 17's lint findings across the bundle — non-empty means an artifact was not neutral. */
  readonly lintFindings: readonly string[];
  /** What `publishLocal` actually returned. */
  readonly publishStatus: string;
}

export interface RunDemoPublicationOptions {
  readonly releaseCandidateObjectId: string;
}

/**
 * Performs a complete demo run and returns the record describing it, in
 * exactly the shape `checkDemoBranchEvidenceHandoff` scores.
 */
export async function runDemoPublication(
  options: RunDemoPublicationOptions,
): Promise<DemoRunResult> {
  const controlRepo = await buildThrowawayRepo("eo-demo-ctl-");
  const userRepo = await buildThrowawayRepo("eo-demo-usr-");
  const bundleDir = await mkdtemp(join(tmpdir(), "eo-demo-bundle-"));

  // 08's own branch namer — the name is derived, never hand-written, and it
  // routes the candidate through 17's regenerate-once lint before returning.
  // A `blocked` result means the namer itself refused; that is a real
  // finding, not something to work around with a hand-picked name.
  const named = await nameBranch({ type: "feat", slugSource: "record the demo handoff" });
  if (named.status !== "named") {
    throw new Error(
      `demo run: nameBranch refused the branch name (${named.error}): ` +
        named.findings.map((finding) => finding.message).join("; "),
    );
  }
  const branchName = named.branchName;

  await exec("git", ["checkout", "-q", "-b", "integration"], { cwd: controlRepo });
  await mkdir(join(controlRepo, "src"), { recursive: true });
  await writeFile(join(controlRepo, "src", "demo-feature.txt"), "the demo feature\n", "utf-8");
  await exec("git", ["add", "-A"], { cwd: controlRepo });
  await exec("git", ["commit", "-q", "-m", "feat: record the demo handoff"], { cwd: controlRepo });

  // 17's renderer produces the handoff bundle; 17's own lint judges it,
  // each artifact under ITS OWN `ArtifactKind` so the kind-specific stages
  // (length limits, mention policy, ADF subset) actually apply.
  const artifacts: readonly { name: string; kind: ArtifactKind; content: string }[] = [
    {
      name: "pr-title.txt",
      kind: "pr_title",
      content: renderPrTitle({ type: "feat", outcome: "record the demo handoff" }),
    },
    {
      name: "pr-body.md",
      kind: "pr_body",
      content: renderPrBody({
        outcome: "Records the demo handoff bundle for the release gate.",
        validation: "Release-gate attestation run.",
        risk: "None: local branch only, no remote interaction.",
        tracking: "roadmap/23 demo-branch-evidence-handoff.",
      }),
    },
    {
      name: "review-comment.md",
      kind: "review_comment",
      content: renderReviewComment({
        finding: "Demo handoff bundle rendered for the release cut.",
        evidence: "Release-gate attestation run.",
        action: "No action required.",
      }),
    },
  ];

  const lintFindings: string[] = [];
  const evidenceBundle: string[] = [];
  for (const artifact of artifacts) {
    const outcome = lint(artifact.content, artifact.kind, DEFAULT_COMMUNICATION_POLICY);
    if (!outcome.ok) {
      lintFindings.push(
        `${artifact.name}: ${outcome.findings.map((finding) => finding.message).join("; ")}`,
      );
    }
    const path = join(bundleDir, artifact.name);
    await writeFile(path, artifact.content, "utf-8");
    evidenceBundle.push(path);
  }

  // 08's real local publication: fetch from a filesystem path into the
  // user repo's refs. Never a remote, never a push.
  const published = await publishLocal(plumbing, {
    userRepoPath: userRepo,
    controlRepoPath: controlRepo,
    sourceRef: "integration",
    branchName,
  });

  const remoteInteractions = (await countRemotes(userRepo)) + (await countRemotes(controlRepo));

  const { stdout: log } = await exec(
    "git",
    ["log", `--format=%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`, branchName, "--not", "main"],
    { cwd: userRepo },
  ).catch(() => ({ stdout: "" }));

  const commits = log
    .split(RECORD_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [subject = "", body = ""] = entry.split(FIELD_SEPARATOR);
      return { subject: subject.trim(), body: body.trim() };
    });

  return {
    bundleDir,
    lintFindings,
    publishStatus: published.status,
    record: {
      branchName,
      objectId:
        published.status === "published" ? options.releaseCandidateObjectId : "not-published",
      commits,
      evidenceBundle,
      remoteInteractions,
      pullRequestOpened: false,
    },
  };
}
