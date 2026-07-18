/**
 * Contract-typed router — roadmap/05-supervisor-daemon.md work item 2:
 * "Contract-typed router carrying every supervisor-owned operation family."
 * Every registered operation validates its params BEFORE the handler runs
 * and its result AFTER the handler returns, against zod schemas supplied
 * at registration time — `../socket/uds-server.ts` is this router's only
 * intended caller (dispatched only after peer-auth admits the connection
 * and the handshake accepts the protocol version).
 */

import type { z } from "zod";

export class DuplicateOperationError extends Error {
  constructor(op: string) {
    super(`supervisor: operation "${op}" is already registered`);
    this.name = "DuplicateOperationError";
  }
}

export class UnknownOperationError extends Error {
  constructor(op: string) {
    super(`supervisor: unknown operation "${op}"`);
    this.name = "UnknownOperationError";
  }
}

export type OperationHandler<P, R> = (params: P) => Promise<R>;

interface RegisteredOperation {
  readonly handler: (params: unknown) => Promise<unknown>;
}

export class SupervisorRouter {
  readonly #operations = new Map<string, RegisteredOperation>();

  /** Registers one operation. Throws `DuplicateOperationError` if `op` is already registered — every operation name is registered exactly once, for the lifetime of this router instance. */
  register<P, R>(
    op: string,
    paramsSchema: z.ZodType<P>,
    resultSchema: z.ZodType<R>,
    handler: OperationHandler<P, R>,
  ): void {
    if (this.#operations.has(op)) {
      throw new DuplicateOperationError(op);
    }
    this.#operations.set(op, {
      handler: async (rawParams: unknown) => {
        const params = paramsSchema.parse(rawParams);
        const result = await handler(params);
        return resultSchema.parse(result);
      },
    });
  }

  /** Every currently-registered operation name, sorted — the Gap 1 conformance scan's own source of truth at runtime. */
  operationNames(): readonly string[] {
    return [...this.#operations.keys()].sort();
  }

  /** Dispatches one request. Throws `UnknownOperationError` for an unregistered `op`; a zod `ZodError` for params/result schema violations. */
  async dispatch(op: string, params: unknown): Promise<unknown> {
    const entry = this.#operations.get(op);
    if (entry === undefined) {
      throw new UnknownOperationError(op);
    }
    return entry.handler(params);
  }
}
