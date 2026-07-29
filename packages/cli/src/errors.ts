/**
 * Typed CLI error hierarchy — roadmap/09-cli-and-doctor.md §Conventions:
 * "stdout = result (human or `--json`), stderr = diagnostics; stable exit
 * codes." Every thrown error a command handler produces is one of these
 * named classes so `../commands/dispatch.ts` can map it to a stable exit
 * code without string-sniffing a message.
 */

/** A malformed invocation — unknown command, missing required positional, unknown flag. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/** A literal secret-shaped value was supplied where only a secret *reference* is accepted (roadmap/09 §Interfaces produced item 5). */
export class SecretValueRejectedError extends Error {
  readonly argument: string;

  constructor(argument: string) {
    super(
      `refusing a literal secret-shaped value for "${argument}" — pass a secret *reference* ` +
        `(e.g. "op://vault/item/field" or "env:MY_VAR"), never the secret value itself`,
    );
    this.name = "SecretValueRejectedError";
    this.argument = argument;
  }
}

/** A command whose backend is not yet wired by a landed phase (roadmap/09 §In scope: "Backends not yet built ... return typed NOT_IMPLEMENTED"). */
export class NotImplementedError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(
      `"${command}" has no backend wired yet (phase 09 stub — see roadmap for the owning phase)`,
    );
    this.name = "NotImplementedError";
    this.command = command;
  }
}

/** The typed UDS client could not reach the supervisor's control socket at all. */
export class SupervisorUnavailableError extends Error {
  /**
   * The bare cause, without this class's own message prefix — kept so a
   * wrapper can re-compose the message (e.g. to append the spawned daemon's
   * stderr tail) without string surgery on `message`.
   */
  readonly causeText: string;

  constructor(cause: string, diagnostics?: string) {
    super(
      `could not reach the supervisor control socket: ${cause}` +
        (diagnostics === undefined
          ? ""
          : `\nthe daemon spawned for this attempt reported:\n${diagnostics}`),
    );
    this.name = "SupervisorUnavailableError";
    this.causeText = cause;
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { toErrorMessage };
