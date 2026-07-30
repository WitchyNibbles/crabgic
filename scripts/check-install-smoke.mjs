// Packs the published package, installs it into a CLEAN project, and runs
// its binary.
//
// WHY: `crabgic@1.0.0` was, until this check existed, uninstallable. It
// declared 13 runtime dependencies on `@crabgic/*` workspace packages —
// every one `private: true`, pinned `0.0.0`, never published and unpublishable
// while private — so `npm install crabgic` died with
// `404 Not Found - GET https://registry.npmjs.org/@crabgic%2fconnectors-grafana`
// and the CLI never linked.
//
// The 15-item release gate scored PASS on everything adjacent to that fact
// and missed it entirely, which is the part worth remembering:
//
//   - `check-published-tarball.mjs` inspects file CONTENTS (282 files, no
//     tests, no sources) and never resolves a dependency;
//   - `reproducible-build` compares tarball HASHES from two clean checkouts,
//     which is equally blind on both sides — two identical broken tarballs
//     compare byte-identical and pass;
//   - nothing anywhere installed the artifact.
//
// npm never lets a version be republished, so shipping that would have burnt
// `1.0.0` permanently. This check is the one that answers the question the
// others only approximate: does the thing we are about to publish actually
// work when installed by a stranger?
//
// It deliberately installs from a PACKED TARBALL into an empty directory
// outside the workspace, with no access to the monorepo's node_modules, so
// workspace hoisting cannot mask a missing dependency.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ROOT = join(REPO_ROOT, "packages", "cli");

function fail(message) {
  process.stderr.write(`check-install-smoke: FAIL — ${message}\n`);
  process.exit(1);
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The exact TypeScript the repository builds with — the consumer probe must not drift onto another. */
function tsVersion() {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
  return root.devDependencies.typescript;
}

/** Matches the repo's own `@types/node`, so the probe compiles against the same lib surface. */
function typesNodeVersion() {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
  return root.devDependencies["@types/node"];
}

const manifest = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf-8"));
const declared = new Set(Object.keys(manifest.dependencies ?? {}));

// (1) No workspace package may remain a declared runtime dependency — that is
//     the exact defect this check exists for.
const internal = [...declared].filter((name) => name.startsWith("@crabgic/"));
if (internal.length > 0) {
  fail(
    `packages/cli declares ${String(internal.length)} unpublished workspace package(s) as runtime ` +
      `dependencies (${internal.join(", ")}). They are private and cannot be installed from the ` +
      "registry; bundle them instead (npm run bundle:cli).",
  );
}

// (3) The real thing: pack, install into an empty project, run the binary.
const scratch = mkdtempSync(join(tmpdir(), "crabgic-install-smoke-"));
try {
  // `npm pack` fires packages/cli's `prepack`, which is what replaces `dist`
  // with the publishable artifact (bundled JS + self-contained declarations).
  // Everything below therefore inspects what will really ship, not the
  // workspace build — those differ deliberately: the workspace keeps tsc's
  // per-file declarations so sibling packages typecheck against the same
  // declaration identity, while the published package needs them inlined.
  const packed = run("npm", ["pack", "--pack-destination", scratch], CLI_ROOT).trim().split("\n");
  const tarball = join(scratch, packed[packed.length - 1].trim());

  const project = join(scratch, "consumer");
  run("mkdir", ["-p", project], scratch);
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({ name: "consumer", version: "1.0.0", private: true }, null, 2)}\n`,
  );

  run("npm", ["install", "--no-audit", "--no-fund", tarball], project);

  // (2) Every bare import the INSTALLED package emits must be declared.
  //
  // Scanned from `node_modules/crabgic`, not from the workspace `dist`:
  // packages/cli's `postpack` restores the workspace build immediately after
  // packing (so sibling packages keep typechecking against tsc's per-file
  // declarations), which means `dist` no longer holds the published artifact
  // by the time this runs. The installed copy is both the real thing and the
  // one a user would get.
  const installedDist = join(project, "node_modules", manifest.name, "dist");
  const emittedImports = new Set();
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith(".js")) {
        const source = readFileSync(full, "utf-8");
        // Static `from "x"` and dynamic `import("x")` only. The specifier must
        // be a BARE package name: relative/absolute paths are the bundle's own
        // chunks, and `$` excludes template-literal interpolations like
        // `` `${from}` ``, which a looser pattern matched as a package called
        // "${from}".
        const patterns = [
          /\bfrom\s*["']([^"'$./][^"'$]*)["']/g,
          /\bimport\s*\(\s*["']([^"'$./][^"'$]*)["']\s*\)/g,
        ];
        for (const pattern of patterns) {
          for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            if (specifier.startsWith("node:")) continue;
            const pkg = specifier.startsWith("@")
              ? specifier.split("/").slice(0, 2).join("/")
              : specifier.split("/")[0];
            emittedImports.add(pkg);
          }
        }
      }
    }
  }
  scan(installedDist);
  const undeclared = [...emittedImports].filter((pkg) => !declared.has(pkg));
  if (undeclared.length > 0) {
    fail(
      `the installed package imports ${undeclared.join(", ")}, which its own package.json does ` +
        "not declare. Those resolve inside this monorepo and would 404 for a real user.",
    );
  }

  const binNames = Object.keys(manifest.bin ?? {});
  if (binNames.length === 0) {
    fail("packages/cli declares no bin — the CLI would install no command at all");
  }

  // EVERY declared bin must link and BOOT. Neither has a `--version`
  // subcommand — the CLI's surface is `doctor`/`run`/`status`/…, and the
  // daemon takes its input from the environment — so the probe is a
  // deliberately invalid invocation and the assertion is about the FAILURE
  // MODE, not a success string.
  //
  // Reaching the program's OWN diagnostic (`unknown command "…"`,
  // `supervisord: CRABGIC_PROJECT_HASH is required`) proves the whole module
  // graph loaded and every import resolved. `ERR_MODULE_NOT_FOUND` /
  // "Cannot find package" proves it did not — which is exactly how the
  // unpublished `@crabgic/*` dependencies manifested, and the one thing this
  // check exists to catch. The failure mode is what shipped broken, so the
  // failure mode is what is asserted.
  for (const binName of binNames) {
    const binPath = join(project, "node_modules", ".bin", binName);
    let stderr = "";
    let exitCode = 0;
    try {
      execFileSync(binPath, ["--crabgic-install-smoke-probe"], {
        cwd: project,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      exitCode = error.status ?? 1;
      stderr = `${error.stderr ?? ""}${error.stdout ?? ""}`;
    }

    if (/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/.test(stderr)) {
      fail(
        `installed \`${binName}\` could not resolve its own dependencies:\n${stderr.trim().slice(0, 600)}`,
      );
    }
    if (exitCode === 0) {
      fail(`installed \`${binName}\` accepted a nonsense argument instead of reporting an error`);
    }
    // It must have said something of its own. A silent non-zero exit would
    // mean the process died before reaching any of its own code, which is
    // indistinguishable from the defect being guarded against.
    if (stderr.trim().length === 0) {
      fail(
        `installed \`${binName}\` exited ${String(exitCode)} without printing any diagnostic — ` +
          "it never reached its own code",
      );
    }
  }

  // (3b) A REAL COMMAND MUST RUN, not just the argument parser.
  //
  // The probe above proves the module graph loads. It does NOT prove the
  // package can do anything, and 1.0.0 shipped with `crabgic doctor` broken
  // in every consuming repo — `Cannot find module
  // '@crabgic/plugin/package.json'`, because the plugin's data assets
  // (subagents, hooks, skills, marketplace.json) were never in the tarball
  // and `resolvePluginSourceDir` looked for a workspace package that is
  // never published. Everything else was green, including this check.
  //
  // `doctor` is the right command to run: it is read-only, needs no
  // credentials and no network, and it exercises the installer's plugin
  // resolution — the exact seam that was broken.
  {
    const doctorPath = join(project, "node_modules", ".bin", "crabgic");
    let output = "";
    try {
      output = execFileSync(doctorPath, ["doctor", "--json"], {
        cwd: project,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      // A non-zero exit is fine — doctor reports faults about the CONSUMING
      // project, which is an empty scratch directory. What must not happen is
      // the command failing to run at all.
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    if (/Cannot find module|unexpected error|ERR_MODULE_NOT_FOUND/.test(output)) {
      fail(
        "`crabgic doctor` could not run from the installed package — the tarball is missing " +
          `something it needs at runtime:\n${output.trim().slice(0, 600)}`,
      );
    }
    if (output.trim().length === 0) {
      fail("`crabgic doctor` produced no output at all from the installed package");
    }
  }

  // (3b) THE DAEMON ENTRY MUST BE RESOLVABLE FROM THE SHIPPED LAYOUT.
  //
  // Found 2026-07-30 by running the built binary in a real scratch project.
  // `spawnSupervisorDaemon` resolved exactly one candidate,
  // `../bin/supervisord.js`, which is correct for the `tsc` layout but wrong
  // for the PUBLISHED one: esbuild splitting puts that code in
  // `dist/chunk-*.js` at the dist root, so the path resolved to
  // `packages/cli/bin/supervisord.js` — never a real file. Every daemon spawn
  // in the published package died with MODULE_NOT_FOUND, and `stdio: "ignore"`
  // swallowed it, so `run`'s dispatch, `status`, `resume` and `cancel` all
  // reported a generic unreachable socket instead of the real cause.
  //
  // Same class as the plugin-asset defect above, same lesson: the bundled
  // layout is not the source layout, and only the real artifact proves it.
  // `doctor` does not spawn the daemon, so it could not have caught this.
  {
    const installed = join(project, "node_modules", "crabgic");
    const daemonBin = manifest.bin?.["crabgic-supervisord"];
    if (typeof daemonBin !== "string") {
      fail('the published manifest declares no "crabgic-supervisord" bin entry');
    }
    const daemonPath = join(installed, daemonBin);
    if (!existsSync(daemonPath)) {
      fail(
        `the daemon entry the manifest points at is not in the tarball: ${daemonBin}\n` +
          "Nothing can spawn a supervisor without it.",
      );
    }
    // And the resolver the CLI actually uses must find it from the SHIPPED
    // module layout — asserted by running the real exported function inside
    // the installed package, not by re-deriving the path here.
    const probe = [
      `import { resolveSupervisordBin } from "${pathToFileURL(join(installed, "dist", "index.js")).href}";`,
      "const resolved = resolveSupervisordBin();",
      "process.stdout.write(resolved);",
    ].join("\n");
    const probePath = join(scratch, "daemon-resolve-probe.mjs");
    writeFileSync(probePath, probe, "utf-8");
    let resolved = "";
    try {
      resolved = execFileSync(process.execPath, [probePath], {
        cwd: project,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      fail(
        "the CLI's own daemon resolver could not find the supervisor entry inside the " +
          `installed package:\n${`${error.stdout ?? ""}${error.stderr ?? ""}`.trim().slice(0, 600)}`,
      );
    }
    if (!existsSync(resolved)) {
      fail(`the CLI's daemon resolver returned a path that does not exist: ${resolved}`);
    }
  }

  // (4) THE TYPES MUST WORK TOO. The package declares `types`/`exports`, so a
  //     consumer can `import { … } from "crabgic"` in TypeScript. `tsc`'s
  //     per-file declarations reference `@crabgic/*` by module specifier and
  //     resolve nowhere outside this monorepo — the runtime defect's exact
  //     twin, in type space, and just as invisible to a hash comparison.
  //     Compiling a real consumer against the INSTALLED package is the only
  //     thing that proves the bundled declarations are self-contained.
  if (manifest.types !== undefined || manifest.exports !== undefined) {
    writeFileSync(
      join(project, "consumer.ts"),
      'import { parseCommand } from "crabgic";\nexport const parsed = parseCommand(["status"]);\n',
    );
    writeFileSync(
      join(project, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: "nodenext",
            moduleResolution: "nodenext",
            target: "es2023",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: ["node"],
          },
          files: ["consumer.ts"],
        },
        null,
        2,
      )}\n`,
    );
    // `@types/node` alongside TypeScript: the declarations legitimately
    // reference `node:https`, `node:stream` and `Buffer`, as any Node library's
    // do. A consumer without Node types is not a realistic consumer of a CLI
    // package, and omitting them here produced TS2591 noise that said nothing
    // about whether the bundle is self-contained.
    run(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--save-dev",
        `typescript@${tsVersion()}`,
        `@types/node@${typesNodeVersion()}`,
      ],
      project,
    );
    try {
      execFileSync(join(project, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
        cwd: project,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      fail(
        "a consumer importing from the INSTALLED package does not typecheck — the published " +
          `declarations are not self-contained:\n${`${error.stdout ?? ""}${error.stderr ?? ""}`.trim().slice(0, 800)}`,
      );
    }
  }

  process.stdout.write(
    `check-install-smoke: PASS — ${manifest.name}@${manifest.version} installs from a packed ` +
      `tarball into a clean project; ${binNames.map((n) => `\`${n}\``).join(" and ")} link, boot, ` +
      "and resolve every dependency they import, and a TypeScript consumer compiles against it.\n",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
