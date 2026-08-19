#!/usr/bin/env node
/**
 * DOES A CONFIG FILE NO `src` WALK SEES CHANGE THE EMITTED DECLARATIONS?
 *
 * Blind spot 9 says yes: `packages/cli/tsconfig.dts.json` extends
 * `./tsconfig.json` — a DESCENDANT, so walking `extends` upward from the unit's
 * own config never reaches it — yet `scripts/bundle-types.mjs:83-84` hands it to
 * the declaration generator as `--project`, and `bundle-cli.mjs:153` copies the
 * result into the published `packages/cli/dist/index.d.ts`.
 *
 * ⚠️ WHY THIS PROBE EXISTS. Round 11 recorded a counterexample labelled "run
 * rather than argued" — flip `stripInternal` and a type disappears. Round 12
 * checked it and it was FALSE HERE: `stripInternal` only removes declarations
 * tagged `/** @internal *\/`, and this repository has **zero** such tags across
 * 1721 tracked `.ts` files, so flipping it changes nothing. The claim was
 * accepted from a reviewer without being re-run. This probe replaces it with
 * one that holds, and is committed so the next reader can re-run it in a second
 * rather than trust either of us.
 *
 * It uses `declarationMap`, which `tsconfig.dts.json` actually sets today.
 *
 * Run:  node docs/evidence/phase-26/config-input-probe.mjs
 * Exits non-zero if a config-only edit stops changing the emitted output.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TSC = join(REPO_ROOT, "node_modules", ".bin", "tsc");

const root = mkdtempSync(join(tmpdir(), "config-input-"));
const src = join(root, "src");
mkdirSync(src, { recursive: true });
writeFileSync(join(src, "index.ts"), "export const answer: number = 42;\n");

/** The unit's own config — the one an upward `extends` walk would find. */
writeFileSync(
  join(root, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "./out",
        rootDir: "./src",
      },
      include: ["src"],
    },
    null,
    2,
  ),
);

/** The DESCENDANT config, the shape `packages/cli/tsconfig.dts.json` has. */
const writeDtsConfig = (declarationMap) =>
  writeFileSync(
    join(root, "tsconfig.dts.json"),
    JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { declarationMap } }, null, 2),
  );

const emit = () => {
  rmSync(join(root, "out"), { recursive: true, force: true });
  execFileSync(TSC, ["--project", join(root, "tsconfig.dts.json")], { cwd: root, stdio: "pipe" });
  return readdirSync(join(root, "out")).sort();
};

writeDtsConfig(false);
const withoutMap = emit();

// ONLY the descendant config changes. No `.ts` file is touched, and the unit's
// own tsconfig.json is untouched.
writeDtsConfig(true);
const withMap = emit();

rmSync(root, { recursive: true, force: true });

console.log(`emitted with declarationMap:false -> ${withoutMap.join(", ")}`);
console.log(`emitted with declarationMap:true  -> ${withMap.join(", ")}`);

/**
 * SECOND CLAIM, from blind spot 7: `.tsbuildinfo` records the compiler version
 * and INVALIDATES on mismatch. Round 13 flagged that as uncited and covered by
 * no assumption. Asserted here rather than cited, because it is reproducible in
 * a second and this record has already been burned once by trusting a
 * reviewer's report of an experiment.
 */
const incrRoot = mkdtempSync(join(tmpdir(), "tsbuildinfo-"));
mkdirSync(join(incrRoot, "src"), { recursive: true });
writeFileSync(join(incrRoot, "src", "index.ts"), "export const n: number = 1;\n");
writeFileSync(
  join(incrRoot, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        composite: true,
        outDir: "./out",
        rootDir: "./src",
        tsBuildInfoFile: "./out/.tsbuildinfo",
      },
      include: ["src"],
    },
    null,
    2,
  ),
);
const build = (args) => execFileSync(TSC, args, { cwd: incrRoot, encoding: "utf8", stdio: "pipe" });
build(["-b", "."]);
const upToDate = build(["-b", ".", "--dry"]);

const infoPath = join(incrRoot, "out", ".tsbuildinfo");
const info = JSON.parse(readFileSync(infoPath, "utf8"));
const realVersion = info.version;
writeFileSync(infoPath, JSON.stringify({ ...info, version: "0.0.0-not-a-real-version" }));
const afterTamper = build(["-b", ".", "--dry"]);
rmSync(incrRoot, { recursive: true, force: true });

const invalidates = /would build/i.test(afterTamper) && /up to date/i.test(upToDate);
console.log(`\n.tsbuildinfo version recorded          : ${realVersion}`);
console.log(`--dry before tampering                 : ${upToDate.trim().split("\n").pop()}`);
console.log(`--dry after version tampering          : ${afterTamper.trim().split("\n").pop()}`);

const changed = JSON.stringify(withoutMap) !== JSON.stringify(withMap);
if (!invalidates) {
  console.error(
    "\nFAIL - tampering with .tsbuildinfo's recorded version did not invalidate the build, so blind spot 7's claim no longer holds here.",
  );
  process.exit(1);
}
if (!changed) {
  console.error(
    "\nFAIL - editing ONLY the descendant config changed nothing, so blind spot 9's premise no longer holds here.",
  );
  process.exit(1);
}
console.log(
  "\nPASS - a config file that no `src` walk sees, and that an upward `extends` walk never reaches, changed the emitted declarations.",
);
