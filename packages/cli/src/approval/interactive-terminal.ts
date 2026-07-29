/**
 * Who is allowed to answer the approval prompt.
 *
 * WHY THIS IS NOT JUST `isTTY` (2026-07-29, adversarial review finding a).
 * `process.stdin.isTTY` asks the kernel one question — "is fd 0 a character
 * device" — and ANY process that allocates a pty answers yes. The finding was
 * reproduced live in this repository: `echo yes | crabgic approve <digest>` is
 * correctly refused, while
 * `script -qec "crabgic approve <digest>" /dev/null <<< yes` sails through a
 * bare `isTTY` check with `confirmed: true`. `script`, `socat` and
 * `python3 -c 'import pty; pty.spawn(...)'` are all commonly present, so a TTY
 * check alone leaves the model's own shell able to mint and spend an approval.
 *
 * So the gate also asks WHERE the process came from. A pty allocated by an
 * agent's shell inherits that agent's environment (`spawn` passes
 * `...process.env`, and `script`/`socat` do too), which means the markers below
 * survive exactly the wrapper that defeats `isTTY`. CI markers are refused for
 * the same reason with less subtlety: adaptation §5.5's gate is a human, and a
 * pipeline is never one.
 *
 * WHAT THIS DOES AND DOES NOT PROVE — read before trusting it. It reliably
 * stops an agent or CI job that approves *opportunistically*: the common,
 * realistic case, where the model is being helpful rather than evasive. It does
 * NOT stop a deliberately evasive caller, because `env -u CLAUDECODE …` strips
 * a marker, and no in-process check can distinguish "a human typed yes at a
 * pty" from "a program wrote yes to a pty it created" — the process cannot see
 * the keyboard. Closing that gap needs consent to arrive out-of-band, through a
 * channel the model did not create (a human-started watcher the daemon queues
 * to, or an OS-mediated confirmation). That is a product decision, recorded as
 * owed in `docs/security-posture.md`, and it is why the shipped docs claim only
 * what this file actually enforces.
 *
 * The standing `EnvelopePolicy` remains the primary control, exactly as
 * roadmap/11 says: "No session-reachable surface may write or widen the policy
 * — that, not the prompt, is now what makes 'the model can never satisfy its
 * own gate' true." This gate guards the escalation path above that floor.
 */

/**
 * Environment markers that identify a process descended from an agent runtime
 * or a CI job. Set by the runtime itself, and inherited through any pty
 * wrapper the descendant allocates.
 */
export const NON_HUMAN_RUNTIME_ENV_MARKERS: readonly string[] = [
  // Claude Code sets these in every tool-invoked shell.
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  // Common CI providers. A pipeline is never the human this gate wants.
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
];

export type ApprovalTerminalVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export interface ApprovalTerminalOptions {
  readonly env: NodeJS.ProcessEnv;
  /** `process.stdin.isTTY` at the call site. */
  readonly isTty: boolean;
}

/** The first marker present in `env`, or `undefined` — a set variable counts even when empty, because a runtime sets it as a flag. */
function firstRuntimeMarker(env: NodeJS.ProcessEnv): string | undefined {
  return NON_HUMAN_RUNTIME_ENV_MARKERS.find((name) => env[name] !== undefined);
}

/** Decides whether this process may render the approval prompt at all. Refuses first, explains why, and never says "allowed" for a reason it has not checked. */
export function resolveApprovalTerminal(options: ApprovalTerminalOptions): ApprovalTerminalVerdict {
  if (!options.isTty) {
    return {
      allowed: false,
      reason:
        "this process has no interactive terminal (stdin is a pipe, file or closed). " +
        "The approval prompt is the human-only gate; a scripted stdin cannot satisfy it.",
    };
  }
  const marker = firstRuntimeMarker(options.env);
  if (marker !== undefined) {
    return {
      allowed: false,
      reason:
        `this process was started by an agent runtime or CI job (${marker} is set in its environment), ` +
        "so its terminal is not a human's. Approve from a terminal you opened yourself.",
    };
  }
  return { allowed: true };
}
