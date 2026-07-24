import { describe, expect, it } from "vitest";
import { ctxFromFiles } from "../test-support/detection-context.js";
import { migrationDetector } from "./migration-detector.js";

describe("migrationDetector", () => {
  it("detects a generic migrations/ directory", () => {
    const findings = migrationDetector.detect(ctxFromFiles({ "migrations/0001_initial.py": "" }));
    expect(findings[0]).toMatchObject({ category: "migration", ecosystem: "generic" });
  });

  it("detects a Rails-style db/migrate/ directory", () => {
    const findings = migrationDetector.detect(
      ctxFromFiles({ "db/migrate/20240101_create_users.rb": "" }),
    );
    expect(findings[0]).toMatchObject({ ecosystem: "rails" });
  });

  it("reports one finding per distinct migration directory, not per file", () => {
    const findings = migrationDetector.detect(
      ctxFromFiles({
        "migrations/0001.py": "",
        "migrations/0002.py": "",
      }),
    );
    expect(findings).toHaveLength(1);
  });

  it("returns an empty array with no migration directory", () => {
    expect(migrationDetector.detect(ctxFromFiles({ "src/index.ts": "" }))).toEqual([]);
  });
});
