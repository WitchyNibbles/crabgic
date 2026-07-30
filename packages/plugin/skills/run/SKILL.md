---
name: run
description: Start a new Crabgic run against the current change intent. Drafts the intake request from the conversation, then hands it to the `crabgic run` CLI.
disable-model-invocation: false
---

# /eo:run

Starts a new orchestrator run for the current project.

**You draft the intake request; the CLI decides what happens to it.** There is no
tool that drafts one for you, deliberately — the request is the contract for the
whole run, and it is assembled from the conversation you have already had with
the owner, not generated behind their back.

## The flow

1. **Understand the work.** Use `project.inspect` (gateway MCP) for repo, stack and
   ChangeSet state. `eo-explore` is the cheap read-heavy subagent for reading around
   the codebase; `eo-reviewer` reads a draft back critically before you commit to it.
2. **Draft the `IntakeRequest`.** Every one of the nine contract sections must be
   answerable — scope, non-goals, audience, compatibility, security, performance,
   observability, rollout, acceptance. If one is not, that is a clarifying question
   for the owner, asked with `AskUserQuestion`, not a section you fill in yourself.
   The request also carries the requirements, the work-unit DAG (each work unit
   owning the requirements it satisfies), the envelope content, and the rollback
   strategy.
3. **Write it to a file and run intake:**

   ```
   crabgic run --json < /path/to/intake.json
   ```

4. **Read the verdict.** Three outcomes, and they mean different things:
   - **`ready`, covered by the standing approval policy** — the envelope is inside
     what the owner already approved at install time. No prompt, no token, nothing
     to ask; the run is dispatched and the output names its id. Proceed.
   - **Escalation** — the envelope reaches outside the standing policy. The output
     names every dimension that escapes, and the policy file's path. Show the owner
     what it needs and why, then tell them to run `crabgic approve <envelope-digest>`
     in **their own terminal**. You cannot do this for them: the command refuses a
     piped stdin and refuses a process carrying agent-runtime provenance.
   - **Not ready** — a requirement no work unit owns. That is a planning gap, not an
     approval question: fix the DAG and run intake again.

## Usage

```
/eo:run
```

## Notes

- If the supervisor is not reachable, the wrapped CLI call surfaces
  `SupervisorUnavailableError`'s message verbatim — this skill never masks it.
- This skill never mints approval tokens and never bypasses the approval gate. The
  standing policy is the routine authority; no tool, command or skill offers to write
  or widen it, and `crabgic install` refuses to author one from a session's own shell.
  It is still a file at the operator's own account, so treat rewriting it the way you
  would treat rewriting their SSH config: not yours to do.
- `crabgic run --json` is the form to parse. Read `standing.status` for the decision
  and `standing.changeSet.state` for where the change set ended up — the
  `outcome.artifacts.changeSet` snapshot is from intake time, before any transition.
  A refusal exits non-zero.
