import { describe, expect, it } from "vitest";
import { folderDefinition } from "../resources/definitions/folder.js";
import { restoreFromSnapshot, type RollbackHttpResponse } from "./rollback.js";
import type { GrafanaParsedResource } from "../resources/resource-definitions.js";

const SNAPSHOT: GrafanaParsedResource = {
  kind: "folder",
  externalId: "fold-1",
  revision: "etag-1",
  fields: { title: "Team Dashboards", parentUid: null },
};

const BASE_PATH = "/api/folders";

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): RollbackHttpResponse {
  return { status, headers, bodyText: JSON.stringify(body) };
}

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A scripted `send` fake — returns one response per call, in order; records every call's request. */
function scriptedSend(responses: readonly RollbackHttpResponse[]) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const send = async (spec: RecordedCall): Promise<RollbackHttpResponse> => {
    calls.push(spec);
    const response = responses[index];
    index += 1;
    if (response === undefined) throw new Error("scriptedSend: script exhausted");
    return response;
  };
  return { send, calls };
}

describe("restoreFromSnapshot — exit criterion: restored resource is canonical-identical to the pre-mutation snapshot", () => {
  it("restores successfully when the read-back matches the snapshot exactly", async () => {
    const { send, calls } = scriptedSend([
      jsonResponse(200, { title: "Renamed By Someone Else" }, { etag: '"etag-2"' }),
      jsonResponse(200, {}),
      jsonResponse(200, { title: "Team Dashboards", parentUid: null }, { etag: '"etag-3"' }),
    ]);

    const outcome = await restoreFromSnapshot(folderDefinition, BASE_PATH, SNAPSHOT, { send });

    expect(outcome.status).toBe("restored");
    if (outcome.status === "restored") {
      expect(outcome.canonical.fields).toEqual(SNAPSHOT.fields);
    }
    expect(calls).toHaveLength(3);
    // The restore write used the FRESH revision observed just before
    // writing, never the stale pre-mutation snapshot's own revision.
    expect(calls[1]?.headers?.["If-Match"]).toBe("etag-2");
  });

  it("blocks (never assumes success) when the initial read fails", async () => {
    const { send, calls } = scriptedSend([jsonResponse(500, {})]);
    const outcome = await restoreFromSnapshot(folderDefinition, BASE_PATH, SNAPSHOT, { send });
    expect(outcome.status).toBe("blocked");
    expect(calls).toHaveLength(1);
  });

  it("blocks when the restore write itself fails", async () => {
    const { send, calls } = scriptedSend([
      jsonResponse(200, { title: "X" }, { etag: '"etag-2"' }),
      jsonResponse(412, {}),
    ]);
    const outcome = await restoreFromSnapshot(folderDefinition, BASE_PATH, SNAPSHOT, { send });
    expect(outcome.status).toBe("blocked");
    expect(calls).toHaveLength(2);
  });

  it("blocks when the post-restore read-back GET itself fails", async () => {
    const { send, calls } = scriptedSend([
      jsonResponse(200, { title: "X" }, { etag: '"etag-2"' }),
      jsonResponse(200, {}),
      jsonResponse(503, {}),
    ]);
    const outcome = await restoreFromSnapshot(folderDefinition, BASE_PATH, SNAPSHOT, { send });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.reason).toMatch(/could not read back/);
    }
    expect(calls).toHaveLength(3);
  });

  it("blocks when the post-restore read-back does not actually match the snapshot (never a false-positive restore)", async () => {
    const { send } = scriptedSend([
      jsonResponse(200, { title: "X" }, { etag: '"etag-2"' }),
      jsonResponse(200, {}),
      jsonResponse(200, { title: "Still Wrong" }, { etag: '"etag-3"' }),
    ]);
    const outcome = await restoreFromSnapshot(folderDefinition, BASE_PATH, SNAPSHOT, { send });
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") {
      expect(outcome.reason).toMatch(/did not match/);
    }
  });
});
