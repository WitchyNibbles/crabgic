/**
 * The failure message for imports the packed bundle makes and its own
 * `package.json` does not declare.
 *
 * WHY THIS IS ITS OWN MODULE. The message has two causes and they need
 * different remedies, and the original conflated them. `prepack` BUNDLES every
 * `@crabgic/*` workspace package into the emitted files, so a bundle that still
 * imports one by name is almost always a bundle that was not rebuilt — not a
 * missing dependency. Measured 2026-09-06: a `check:all` run after per-package
 * `tsc -b` (which does not refresh `packages/cli/dist`) reported eight
 * undeclared `@crabgic/*` imports and told the reader they "would 404 for a
 * real user". The check was right that the artifact was broken and wrong about
 * why, and the reader went looking for a dependency-declaration defect that
 * did not exist. `npm run build` was the whole fix.
 *
 * Same discipline as the impossible-specifier refusal in
 * `../check-install-smoke.mjs`: a check that names the wrong cause costs more
 * than one that says less.
 */
const WORKSPACE_SCOPE = "@crabgic/";

/** True when every name is a workspace package `prepack` should have inlined. */
function allAreBundledWorkspacePackages(undeclared) {
  return undeclared.length > 0 && undeclared.every((name) => name.startsWith(WORKSPACE_SCOPE));
}

export function describeUndeclaredImports(undeclared) {
  const names = undeclared.join(", ");
  const consequence = `Those resolve inside this monorepo and would 404 for a real user.`;

  if (allAreBundledWorkspacePackages(undeclared)) {
    return (
      `the installed package imports ${names}, which its own package.json does not declare. ` +
      `Every one of those is a workspace package \`prepack\` bundles INTO the emitted files, so ` +
      `the usual cause is a stale bundle: run \`npm run build\` and re-run this check. ` +
      `A per-package \`tsc -b\` does not refresh packages/cli/dist. ` +
      `If a rebuild does not clear it, the bundling itself regressed — ${consequence}`
    );
  }

  return (
    `the installed package imports ${names}, which its own package.json does not declare. ` +
    consequence
  );
}
