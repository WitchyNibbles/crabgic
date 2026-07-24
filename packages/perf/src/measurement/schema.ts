import { z } from "zod";
import { NonEmptyStringSchema } from "@eo/contracts";

/**
 * `ResourceCaptureArtifact` — roadmap/15 §In scope, "Resource capture":
 * "`/proc` + `getrusage` wrappers around the benchmarked base/candidate
 * processes only … raw samples archived; summaries recorded into
 * EvidenceRecord."
 *
 * SECURITY (roadmap/15 §Critical correctness points, "Secret-leakage"):
 * "resource-capture artifacts contain NO process environment/argv content
 * (a real leakage vector into evidence)." This schema is, BY CONSTRUCTION,
 * a closed set of NUMERIC resource-usage fields plus the benchmarked
 * COMMAND STRING (public `ProjectProfile`-declared config, not raw argv/
 * env) — there is no field this schema could even accept an
 * environment-variable map or an argv array into. `.strict()` additionally
 * rejects any extra property a careless caller might try to smuggle in
 * (e.g. an ad-hoc `env` field), so a schema-level defense backs the
 * construction-level one (see `./secret-leakage.test.ts`).
 */
export const ResourceCaptureArtifactSchema = z
  .object({
    /** The benchmarked command's declared invocation string (public config, e.g. `ProjectProfile.benchmarkCommand` — never raw process argv). */
    command: NonEmptyStringSchema,
    /** Wall-clock duration of the benchmarked process, milliseconds. */
    wallTimeMs: z.number().nonnegative(),
    /** User-mode CPU time, milliseconds (`getrusage`'s `ru_utime` / `/proc/<pid>/stat`'s `utime`). */
    cpuUserMs: z.number().nonnegative(),
    /** Kernel-mode CPU time, milliseconds (`getrusage`'s `ru_stime` / `/proc/<pid>/stat`'s `stime`). */
    cpuSystemMs: z.number().nonnegative(),
    /** Peak resident set size, kilobytes (`getrusage`'s `ru_maxrss` / `/proc/<pid>/status`'s `VmHWM`). */
    peakRssKb: z.number().nonnegative(),
    /** fs/network byte count read, when the adapter can observe it (`/proc/<pid>/io`'s `rchar`). Optional: not every adapter/process exposes this. */
    ioReadBytes: z.number().nonnegative().optional(),
    /** fs/network byte count written, when observable (`/proc/<pid>/io`'s `wchar`). */
    ioWriteBytes: z.number().nonnegative().optional(),
    /** The process's own exit code. */
    exitCode: z.number().int(),
  })
  .strict();

export type ResourceCaptureArtifact = z.infer<typeof ResourceCaptureArtifactSchema>;
