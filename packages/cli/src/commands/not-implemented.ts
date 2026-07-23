/**
 * The typed `NOT_IMPLEMENTED` shape — roadmap/09-cli-and-doctor.md §In
 * scope: "Backends not yet built by a landed phase return typed
 * `NOT_IMPLEMENTED` until wired." Work item 1's failing-first framing:
 * "invoking a command with no backend registered yet returns the exact
 * `NOT_IMPLEMENTED` typed shape, not a crash or an untyped error."
 */
import { EXIT_NOT_IMPLEMENTED } from "../exit-codes.js";
import { formatJson, type CommandResult } from "../output/format.js";

export interface NotImplementedShape {
  readonly status: "NOT_IMPLEMENTED";
  readonly command: string;
  readonly message: string;
}

export function buildNotImplementedShape(command: string): NotImplementedShape {
  return {
    status: "NOT_IMPLEMENTED",
    command,
    message: `"${command}" has no backend wired yet — see the roadmap for the phase that lands it`,
  };
}

export function notImplementedResult(command: string, json: boolean): CommandResult {
  const shape = buildNotImplementedShape(command);
  return {
    exitCode: EXIT_NOT_IMPLEMENTED,
    stdout: json ? formatJson(shape) : `${shape.message}\n`,
  };
}
