import { describe, expect, it } from "vitest";
import {
  classifyDiffPath,
  classifyDiffPaths,
  unionDiffPathRiskCategories,
} from "./diff-analyzer.js";

describe("classifyDiffPath", () => {
  it("tags a caching-module path", () => {
    expect(classifyDiffPath("src/cache/lru-cache.ts")).toContain("caching");
  });

  it("tags a database-module path", () => {
    expect(classifyDiffPath("src/repository/user-repository.ts")).toContain("database");
  });

  it("tags a networking-module path", () => {
    expect(classifyDiffPath("src/http/client.ts")).toContain("networking");
  });

  it("tags a concurrency-module path", () => {
    expect(classifyDiffPath("src/worker/thread-pool.ts")).toContain("concurrency");
  });

  it("tags an allocation-module path", () => {
    expect(classifyDiffPath("src/buffer/arena-allocator.ts")).toContain("allocation");
  });

  it("tags a serialization-module path", () => {
    expect(classifyDiffPath("src/codec/proto-encode.ts")).toContain("serialization");
  });

  it("tags a dataset-size path", () => {
    expect(classifyDiffPath("scripts/bulk-import-seed.ts")).toContain("dataset_size");
  });

  it("tags a user-visible-hot-path path", () => {
    expect(classifyDiffPath("src/routes/checkout-handler.ts")).toContain("user_visible_hot_path");
  });

  it("tags an io path", () => {
    expect(classifyDiffPath("src/fs/read-stream.ts")).toContain("io");
  });

  it("tags a copying path", () => {
    expect(classifyDiffPath("src/util/deep-clone.ts")).toContain("copying");
  });

  it("tags a cpu path", () => {
    expect(classifyDiffPath("src/algorithm/sort-large.ts")).toContain("cpu");
  });

  it("returns zero categories for an unrelated path", () => {
    expect(classifyDiffPath("README.md")).toEqual([]);
  });

  it("a path can match more than one category", () => {
    const categories = classifyDiffPath("src/cache/database-query-cache.ts");
    expect(categories).toContain("caching");
    expect(categories).toContain("database");
  });
});

describe("classifyDiffPaths / unionDiffPathRiskCategories", () => {
  it("classifyDiffPaths returns one entry per path, including zero-match paths", () => {
    const result = classifyDiffPaths(["src/cache/lru.ts", "README.md"]);
    expect(result).toHaveLength(2);
    expect(result[0]?.categories).toContain("caching");
    expect(result[1]?.categories).toEqual([]);
  });

  it("unionDiffPathRiskCategories unions categories across the whole diff", () => {
    const union = unionDiffPathRiskCategories([
      "src/cache/lru.ts",
      "src/http/client.ts",
      "README.md",
    ]);
    expect(union.has("caching")).toBe(true);
    expect(union.has("networking")).toBe(true);
    expect(union.size).toBe(2);
  });

  it("an empty diff produces an empty union", () => {
    expect(unionDiffPathRiskCategories([]).size).toBe(0);
  });
});
