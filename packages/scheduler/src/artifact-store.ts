/**
 * Artifact store — roadmap/13-scheduler-packets-context.md §In scope,
 * "Artifact store": "raw logs/tests/benchmarks as bounded artifacts,
 * addressed by work-unit/attempt id; manager context gets decisions +
 * compressed evidence only; the benchmark slot is where 15 archives its
 * raw resource-capture samples." §Work items 3: "Artifact store +
 * summary-projection helpers, incl. the benchmark-sample slot 15 archives
 * into."
 *
 * SHADOW-RUN ISOLATION (roadmap/13 §In scope, shadow-run bullet; §Test
 * plan, Security: "shadow-run isolation — a shadow attempt's artifacts...
 * are never reachable from the primary attempt's read path"): this store
 * has NO notion of "shadow" built in — isolation is achieved by
 * CONSTRUCTION, not by an internal flag: `./shadow-run.ts` always
 * constructs a brand-new `ArtifactStore` instance for a shadow attempt and
 * never shares or merges it with the primary's own instance. Two distinct
 * `ArtifactStore` objects can never observe each other's records, even
 * under an adversarial same-`(workUnitId, attemptId)` collision, because
 * each instance's `#records` map is private to that instance.
 */

export type ArtifactKind = "log" | "test" | "benchmark";

export interface ArtifactRecord {
  readonly workUnitId: string;
  readonly attemptId: string;
  readonly kind: ArtifactKind;
  readonly content: string;
  readonly createdAt: string;
}

/** Bounded — this phase's own minimal-sufficient ceiling (no byte figure is pinned by any cited source material); a caller that needs to store something larger must chunk it across multiple `put()` calls. */
export const MAX_ARTIFACT_BYTES = 500_000;

export class ArtifactTooLargeError extends Error {
  constructor(
    readonly actualBytes: number,
    readonly limitBytes: number,
  ) {
    super(
      `artifact content is ${String(actualBytes)} bytes, exceeding the ${String(limitBytes)}-byte bound`,
    );
    this.name = "ArtifactTooLargeError";
  }
}

export interface PutArtifactOptions {
  readonly workUnitId: string;
  readonly attemptId: string;
  readonly kind: ArtifactKind;
  readonly content: string;
  readonly now?: () => Date;
}

/** A condensed, manager-context-safe projection of one artifact — never the raw content in full (roadmap/13: "manager context gets decisions + compressed evidence only"). */
export interface ArtifactSummary {
  readonly workUnitId: string;
  readonly attemptId: string;
  readonly kind: ArtifactKind;
  readonly byteLength: number;
  /** First 200 chars of the raw content — enough for a human/manager to recognize what it is, never the whole payload. */
  readonly excerpt: string;
  readonly createdAt: string;
}

const EXCERPT_LENGTH = 200;

function toSummary(record: ArtifactRecord): ArtifactSummary {
  return {
    workUnitId: record.workUnitId,
    attemptId: record.attemptId,
    kind: record.kind,
    byteLength: record.content.length,
    excerpt: record.content.slice(0, EXCERPT_LENGTH),
    createdAt: record.createdAt,
  };
}

function recordKey(workUnitId: string, attemptId: string): string {
  return `${workUnitId}::${attemptId}`;
}

/**
 * Bounded raw-artifact store, addressed by `(workUnitId, attemptId)`. Each
 * instance is fully self-contained (see file-level doc comment on shadow-
 * run isolation) — never a shared/global singleton.
 */
export class ArtifactStore {
  readonly #records = new Map<string, ArtifactRecord[]>();

  put(options: PutArtifactOptions): ArtifactRecord {
    if (options.content.length > MAX_ARTIFACT_BYTES) {
      throw new ArtifactTooLargeError(options.content.length, MAX_ARTIFACT_BYTES);
    }
    const now = options.now ?? ((): Date => new Date());
    const record: ArtifactRecord = {
      workUnitId: options.workUnitId,
      attemptId: options.attemptId,
      kind: options.kind,
      content: options.content,
      createdAt: now().toISOString(),
    };
    const key = recordKey(options.workUnitId, options.attemptId);
    const existing = this.#records.get(key) ?? [];
    this.#records.set(key, [...existing, record]);
    return record;
  }

  /** Every raw artifact recorded for `(workUnitId, attemptId)`, in insertion order. */
  list(workUnitId: string, attemptId: string): readonly ArtifactRecord[] {
    return this.#records.get(recordKey(workUnitId, attemptId)) ?? [];
  }

  /** Every raw benchmark-kind artifact for `(workUnitId, attemptId)` — the slot 15 archives its raw resource-capture samples into. */
  listBenchmarks(workUnitId: string, attemptId: string): readonly ArtifactRecord[] {
    return this.list(workUnitId, attemptId).filter((r) => r.kind === "benchmark");
  }

  /** Compressed, manager-context-safe projections for `(workUnitId, attemptId)` — never the raw content. */
  projectSummary(workUnitId: string, attemptId: string): readonly ArtifactSummary[] {
    return this.list(workUnitId, attemptId).map(toSummary);
  }

  get recordCount(): number {
    let total = 0;
    for (const records of this.#records.values()) total += records.length;
    return total;
  }
}
