/**
 * The testable core of `./bin.ts` — argv parsing + error-to-exit-code
 * mapping + dependency wiring, factored out from the real process/stdio
 * touch points so it can run under vitest against injected dependencies.
 * `./bin.ts` itself is a thin (untested-by-design) shim: read real argv,
 * call this, write to real stdout/stderr, set `process.exitCode`.
 */
import { connectGatewayMcpStdio } from "@crabgic/gateway";
import { parseCommand } from "./argv/parse-command.js";
import { buildRealGatewayToolRegistry } from "./bootstrap.js";
import { dispatchCommand } from "./commands/dispatch.js";
import type { CliDependencies } from "./commands/types.js";
import { CliUsageError, SecretValueRejectedError } from "./errors.js";
import { EXIT_SECRET_REJECTED, EXIT_USAGE_ERROR } from "./exit-codes.js";
import type { CommandResult } from "./output/format.js";

export interface CliEntryIo {
  readonly writeStdout: (chunk: string) => void;
  readonly writeStderr: (chunk: string) => void;
}

export interface CliEntryDependencies {
  /** Builds the real `CliDependencies` bag lazily — only invoked for a command that actually needs it (never for `gateway-mcp`, `help`, or a parse failure). */
  readonly buildDependencies: () => CliDependencies;
  /** Boots `gateway mcp`'s stdio server; only invoked for that one command. Defaults to the real, fully-populated boot over real stdio when omitted. */
  readonly runGatewayMcp?: () => Promise<void>;
}

/**
 * The real `gateway mcp` boot: every tool family this binary exposes,
 * registered against this project's durable state, served over a real MCP
 * stdio transport. Resolves when the parent closes the pipe.
 *
 * This used to boot an EMPTY registry over a hand-rolled JSON-RPC subset
 * implementing `tools/list` only — so every family the roadmap built was
 * unreachable from the shipped binary, and `tools/call` answered
 * METHOD_NOT_FOUND unconditionally.
 */
async function defaultRunGatewayMcp(): Promise<void> {
  const server = await connectGatewayMcpStdio(buildRealGatewayToolRegistry());
  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
}

/** Parses `argv`, dispatches it, and writes the result through `io`. Returns the process exit code — never throws for a well-formed usage/secret-rejection error (those map to a stable exit code + stderr diagnostic instead). */
export async function runCliEntry(
  argv: readonly string[],
  io: CliEntryIo,
  deps: CliEntryDependencies,
): Promise<number> {
  let command;
  try {
    command = parseCommand(argv);
  } catch (err) {
    if (err instanceof SecretValueRejectedError) {
      io.writeStderr(`${err.message}\n`);
      return EXIT_SECRET_REJECTED;
    }
    if (err instanceof CliUsageError) {
      io.writeStderr(`${err.message}\n`);
      return EXIT_USAGE_ERROR;
    }
    throw err;
  }

  if (command.command === "gateway-mcp") {
    await (deps.runGatewayMcp ?? defaultRunGatewayMcp)();
    return 0;
  }

  const result: CommandResult = await dispatchCommand(command, deps.buildDependencies());
  if (result.stdout !== undefined) io.writeStdout(result.stdout);
  if (result.stderr !== undefined) io.writeStderr(result.stderr);
  return result.exitCode;
}
