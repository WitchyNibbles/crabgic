import type { TaskPacket, Timestamp } from "@eo/contracts";
import type { AdjudicationCallback } from "./adjudication.js";
import type { CompiledWorkerProfile } from "../compiler/compiled-worker-profile.js";
import type { EngineAdapter } from "./engine-adapter.js";
import type { EngineCapabilities } from "./engine-capabilities.js";
import type { EngineEvent } from "./engine-event.js";
import type { SessionRef } from "./session-ref.js";
import type { WorkerHandle } from "./worker-handle.js";

async function* emptyEvents(): AsyncGenerator<EngineEvent> {
  // A minimal stub yields nothing. The scriptable fake engine phases 05/06
  // import (packages/testkit, roadmap/03 work item 5 — a different
  // worker's deliverable) replays a real EngineEvent stream; this stub
  // exists only to prove `EngineAdapter` is satisfiable at all.
}

/**
 * `StubEngineAdapter` — a minimal, type-conformance-only `EngineAdapter`
 * implementation used solely by this package's own tests (roadmap/03 work
 * item 1: "a stub-conformance test asserting a minimal stub adapter
 * satisfies the interface"). This is NOT the scriptable fake engine
 * phases 05/06 depend on.
 */
export class StubEngineAdapter implements EngineAdapter {
  spawn(
    _packet: TaskPacket,
    _profile: CompiledWorkerProfile,
    _adjudicate: AdjudicationCallback,
  ): WorkerHandle {
    return {
      sessionRef: {
        sessionId: "stub-session-id",
        projectDirectory: "/stub/project",
        worktreePath: "/stub/project/worktree",
        configDir: "/stub/claude-config",
      },
      events: emptyEvents(),
    };
  }

  resume(sessionRef: SessionRef, _adjudicate: AdjudicationCallback): WorkerHandle {
    return { sessionRef, events: emptyEvents() };
  }

  async cancel(_handle: WorkerHandle, _deadline: Timestamp): Promise<void> {
    return;
  }

  capabilities(): EngineCapabilities {
    return {
      supportsJsonSchema: true,
      supportsSessionResume: true,
      permissionModel: "stub-dontAsk",
      sandboxModel: "stub-bubblewrap",
      engineVersion: "0.0.0-stub",
    };
  }
}
