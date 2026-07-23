/**
 * Generic argv tokenizer — splits a raw argv slice into ordered positional
 * tokens plus a flag map, supporting `--flag`, `--flag value`, and
 * `--flag=value` forms. Deliberately dependency-free (no yargs/commander):
 * this repo's convention favors small, purpose-built modules over a heavy
 * general-purpose parsing library for a closed, fully-enumerated command
 * surface (roadmap/09's own command list is exhaustive, not open-ended).
 */
import { CliUsageError } from "../errors.js";

export interface Tokenized {
  readonly positionals: readonly string[];
  /** Value is `true` for a bare `--flag`; the supplied string for `--flag value`/`--flag=value`. Repeated flags: last write wins. */
  readonly flags: ReadonlyMap<string, string | true>;
}

export function tokenize(argv: readonly string[], valueFlagNames: readonly string[] = []): Tokenized {
  const valueFlags = new Set<string>(valueFlagNames);
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex !== -1) {
      const name = body.slice(0, eqIndex);
      const value = body.slice(eqIndex + 1);
      if (name.length === 0) {
        throw new CliUsageError(`malformed flag "${token}"`);
      }
      flags.set(name, value);
      continue;
    }

    if (body.length === 0) {
      throw new CliUsageError(`malformed flag "${token}"`);
    }

    if (valueFlags.has(body)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new CliUsageError(`flag "--${body}" requires a value`);
      }
      flags.set(body, next);
      i += 1;
      continue;
    }

    flags.set(body, true);
  }

  return { positionals, flags };
}

/** Reads a boolean (bare) flag; throws if it was supplied with a `=value`/space-value form. */
export function readBooleanFlag(tokenized: Tokenized, name: string): boolean {
  const value = tokenized.flags.get(name);
  if (value === undefined) return false;
  if (value !== true) {
    throw new CliUsageError(`flag "--${name}" does not take a value`);
  }
  return true;
}

/** Reads a value flag; throws if it was supplied bare with no value. */
export function readValueFlag(tokenized: Tokenized, name: string): string | undefined {
  const value = tokenized.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliUsageError(`flag "--${name}" requires a value`);
  }
  return value;
}

/** Every flag name actually supplied, for "unknown flag" validation by a caller that knows its own allowlist. */
export function suppliedFlagNames(tokenized: Tokenized): readonly string[] {
  return [...tokenized.flags.keys()];
}
