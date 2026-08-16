import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPipelinePlan } from "./pipeline-plan-handler.js";

/**
 * THE SEAM BETWEEN THE DECIDING HALF AND THE DISPATCHING HALF.
 *
 * `pipeline.plan` decides what a round contains; `stage-round.mjs` and
 * `stage-loop.mjs` spawn what it names. They are joined by nothing but field
 * names in a JSON blob passed as `args`, across a boundary the type system
 * cannot reach: a workflow script has no imports, so it cannot be compiled
 * against `PipelinePlanResult`.
 *
 * A rename on either side therefore fails SILENTLY and in the worst possible
 * way. `plan.lenses` reading `undefined` makes `stage-round` log "planned NO
 * lenses" and return a round in which nothing was reviewed; `plan.ownerGated`
 * reading `undefined` dispatches reviewers at an owner gate, manufacturing a
 * second route to closure past a human. Neither raises an error, and the
 * pipeline's own tests on each side keep passing.
 *
 * So the seam is pinned here, by reading the scripts as TEXT — the only way to
 * observe what an unimportable file depends on — and holding every field they
 * name against a real plan the handler emits.
 */

const WORKFLOWS = join(import.meta.dirname, "..", "..", "..", "plugin", "workflows");
const scriptText = (name: string): string => readFileSync(join(WORKFLOWS, name), "utf8");

/** Every `plan.<field>` a script reads. Text, because the script cannot be imported. */
function planFieldsRead(source: string): readonly string[] {
  return [...new Set([...source.matchAll(/\bplan\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!))];
}

describe("the pipeline.plan → stage-round/stage-loop seam", () => {
  // A stage with lenses AND skips, so the roster fields are non-empty.
  const plan = runPipelinePlan({
    completedStages: [
      "research",
      "clarify",
      "design",
      "design-gate",
      "plan",
      "implement",
      "integrate",
    ],
  });

  it("emits the audit stage with both a roster and stated skips", () => {
    // Guards the fixture itself: if this stopped being the audit stage the
    // assertions below would pass vacuously against an empty plan.
    expect(plan.stage).toBe("audit");
    expect(plan.lenses?.length ?? 0).toBeGreaterThan(0);
    expect(plan.skippedLenses?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(["stage-round.mjs", "stage-loop.mjs"])(
    "%s reads only fields the handler actually emits",
    (script) => {
      const emitted = new Set(Object.keys(plan));
      // Supplied by the LOOP, not the handler: `stage-loop` builds
      // `{...plan, artifactRef, round}` before handing the plan to
      // `stage-round`. Named here so the exemption is explicit rather than a
      // hole in the check.
      const suppliedByCaller = new Set(["artifactRef", "round"]);
      const unknown = planFieldsRead(scriptText(script)).filter(
        (field) => !emitted.has(field) && !suppliedByCaller.has(field),
      );
      expect(unknown, `${script} reads plan fields the handler never emits`).toEqual([]);
    },
  );

  it.each(["stage-round.mjs", "stage-loop.mjs"])(
    "%s reads only PLANNED-LENS fields the handler actually emits",
    (script) => {
      // The `plan.<field>` check above never looked inside a lens, so
      // `lens.reviewer` — which decides which subagent every review is
      // dispatched to — sat outside the seam it belongs to. A lens field that
      // reads `undefined` is the same failure mode one level down: the round
      // runs, and it runs wrong.
      const lenses = plan.lenses ?? [];
      expect(lenses.length).toBeGreaterThan(0);
      const emitted = new Set(Object.keys(lenses[0]!));
      // `lens?.reviewer` as well as `lens.reviewer`. The first version of this
      // matched only the un-guarded form and stayed GREEN with `reviewer`
      // deleted from the handler — blind to the single field it was added for,
      // because the script reads it through an optional chain.
      const read = [
        ...new Set(
          [...scriptText(script).matchAll(/\blens\??\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!),
        ),
      ];
      expect(read.filter((f) => !emitted.has(f)), `${script} reads unemitted lens fields`).toEqual(
        [],
      );
    },
  );

  it("names a dispatchable reviewer on every planned lens of every stage", () => {
    // `stage-round` throws on a lens the plan did not label, so an unlabelled
    // lens is a dead round rather than a mis-dispatched one. Held here against
    // the handler that actually serves the wire.
    for (const completed of [
      [],
      ["research", "clarify", "design", "design-gate", "plan"],
      ["research", "clarify", "design", "design-gate", "plan", "implement", "integrate"],
    ]) {
      const stagePlan = runPipelinePlan({ completedStages: completed });
      for (const lens of stagePlan.lenses ?? []) {
        expect(["eo-reviewer", "eo-domain-reviewer"], `${stagePlan.stage}/${lens.lens}`).toContain(
          lens.reviewer,
        );
      }
    }
  });

  it("emits `ownerGated` truthfully for a gate — the field that stops a reviewer closing it", () => {
    const gate = runPipelinePlan({ completedStages: ["research", "clarify", "design"] });
    expect(gate.stage).toBe("design-gate");
    expect(gate.ownerGated).toBe(true);
    // And `stage-round` must be the thing that consults it.
    expect(scriptText("stage-round.mjs")).toContain("plan.ownerGated");
  });
});
