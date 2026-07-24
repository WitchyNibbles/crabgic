/**
 * `project.inspect` tool handler — a thin wrapper around
 * `@eo/supervisor`'s `runProjectInspect`, matching
 * `packages/detect/src/mcp/capability-audit-handler.ts`'s own "plain
 * exported function, not yet wired to a real `tools/call` dispatcher"
 * convention (see `./tool-definitions.ts`'s own doc comment for why).
 */
import {
  runProjectInspect,
  type ProjectInspectDeps,
  type ProjectInspectReport,
} from "@eo/supervisor";

export interface ProjectInspectToolInput {
  readonly changeSetId?: string;
}

export async function runProjectInspectTool(
  input: ProjectInspectToolInput,
  deps: ProjectInspectDeps,
): Promise<ProjectInspectReport> {
  return runProjectInspect(
    deps,
    input.changeSetId !== undefined ? { changeSetId: input.changeSetId } : {},
  );
}
