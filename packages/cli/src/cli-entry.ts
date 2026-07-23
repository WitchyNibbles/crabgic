/**
 * The testable core of `./bin.ts` — argv parsing + error-to-exit-code
 * mapping + dependency wiring, factored out from the real process/stdio
 * touch points so it can run under vitest against injected dependencies.
 * `./bin.ts` itself is a thin (untested-by-design) shim: read real argv,
 * call this, write to real stdout/stderr, set `process.exitCode`.
 */
import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import { parseCommand } from "./argv/parse-command.js";
import { dispatchCommand } from "./commands/dispatch.js";
import type { CliDependencies } from "./commands/types.js";
import { createToolRegistry } from "./gateway-mcp/registry.js";
import { startGatewayMcpServer } from "./gateway-mcp/stdio-server.js";
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
  /** Boots `gateway mcp`'s stdio server; only invoked for that one command. Defaults to a real, empty-registry boot over real stdio when omitted. */
  readonly runGatewayMcp?: () => Promise<void>;
}

async function defaultRunGatewayMcp(): Promise<void> {
  const registry = createToolRegistry();
  void GATEWAY_MCP_SERVER_NAME; // the identity this server registers under — see gateway-mcp/stdio-server.ts
  const handle = startGatewayMcpServer({ registry });
  await handle.closed;
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
