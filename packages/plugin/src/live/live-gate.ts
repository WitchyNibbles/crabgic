/**
 * Minimal `@live` gate for THIS package's own smoke test — deliberately not
 * a re-implementation of `@eo/engine-claude`'s much larger live harness
 * (rate-limit guard, auth provisioning, sanitization scan — all 06's own
 * scope for its worker-conformance suite). This phase's own live surface is
 * narrower (roadmap/10 §Test plan, Conformance: "one subagent spawnable"),
 * and the `engine-live` CI job (01/06 convention, reused per roadmap/10
 * §Interfaces consumed) already fails fast without
 * `CLAUDE_CODE_OAUTH_TOKEN` before `npm run test:live` even starts — this
 * gate only needs to reproduce the `EO_LIVE` fail-red convention itself.
 */
export class LiveEnvNotEnabledError extends Error {
  constructor() {
    super(
      "EO_LIVE is not set to '1' — this @live plugin-load smoke test refuses to run and MUST " +
        "fail red, never skip silently, exactly like the engine-claude @live suite's own convention.",
    );
    this.name = "LiveEnvNotEnabledError";
  }
}

export function assertLiveEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.EO_LIVE !== "1") {
    throw new LiveEnvNotEnabledError();
  }
}
