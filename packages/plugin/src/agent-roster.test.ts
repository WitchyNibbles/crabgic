import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_LENS_IDS } from "@crabgic/contracts";
import { resolvePluginRoot } from "./plugin-root.js";

/**
 * The producer roster — roadmap/25 work items 5, 8 and 9.
 *
 * Every stage of the owner's pipeline needs something that PRODUCES its
 * artifact. Before this the roster had five agents and three stages had no
 * producer at all, so `pipeline.plan` could name a lens nobody could run.
 *
 * These tests exist because an agent is a markdown file, and a markdown file is
 * the easiest thing in this repository to get subtly wrong: a frontmatter typo
 * makes an agent silently unavailable, and nothing else would notice.
 */

const AGENTS_DIR = join(resolvePluginRoot(), "agents");

function agentFile(name: string): string {
  return readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
}

function frontmatter(name: string): string {
  const body = agentFile(name);
  const end = body.indexOf("---", 3);
  return body.slice(0, end);
}

const EXPECTED_AGENTS = [
  "eo-architect",
  "eo-documenter",
  "eo-domain-reviewer",
  "eo-explore",
  "eo-planner",
  "eo-researcher",
  "eo-reviewer",
  "eo-roaster",
];

describe("the agent roster", () => {
  it("ships exactly the agents the pipeline dispatches", () => {
    const found = readdirSync(AGENTS_DIR)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, ""))
      .sort();
    expect(found).toEqual(EXPECTED_AGENTS);
  });

  it("gives every agent the frontmatter Claude Code requires to load it", () => {
    // A missing `name` or `description` does not error -- it makes the agent
    // silently unavailable, which is indistinguishable from a stage nobody ran.
    for (const agent of EXPECTED_AGENTS) {
      const head = frontmatter(agent);
      expect(head, `${agent} frontmatter name`).toMatch(/\nname: /);
      expect(head, `${agent} frontmatter description`).toMatch(/\ndescription: /);
      expect(head, `${agent} frontmatter tools`).toMatch(/\ntools: /);
      expect(head, `${agent} frontmatter model`).toMatch(/\nmodel: /);
    }
  });

  it("declares each agent's own name in its frontmatter", () => {
    // The file name and the declared name are two places one identity lives.
    // Claude Code dispatches on the declared one, so a mismatch is an agent
    // nobody can invoke by the name the plan returns.
    for (const agent of EXPECTED_AGENTS) {
      expect(frontmatter(agent)).toMatch(new RegExp(`\\nname: ${agent}\\b`));
    }
  });
});

describe("the web-research grant is confined to one agent", () => {
  it("gives eo-researcher WebSearch and WebFetch", () => {
    // Owner ruling R1 (2026-08-15). Without it, steps 2, 5 and 13 of the
    // owner's pipeline are repository-local searches wearing the word
    // "research".
    const tools = frontmatter("eo-researcher");
    expect(tools).toMatch(/WebSearch/);
    expect(tools).toMatch(/WebFetch/);
  });

  it("gives NO other agent either tool", () => {
    // The boundary R1 was granted on. Fetched content is untrusted input, and
    // it is only safe here because this one agent cannot write anything and is
    // never dispatched as a worker.
    for (const agent of EXPECTED_AGENTS.filter((name) => name !== "eo-researcher")) {
      expect(frontmatter(agent), `${agent} must not hold web tools`).not.toMatch(
        /WebSearch|WebFetch/,
      );
    }
  });

  it("keeps every agent read-only — no Write, Edit or Bash anywhere", () => {
    // `Bash` is not constrainable to read-only at the tool-declaration level, so
    // its absence is what makes "never write-capable" true of the declared tool
    // set rather than only of the prose. Manager-side agents propose; workers
    // write, under an envelope, in a worktree.
    for (const agent of EXPECTED_AGENTS) {
      expect(frontmatter(agent), `${agent} tool set`).not.toMatch(/"Write"|"Edit"|"Bash"/);
    }
  });
});

describe("eo-domain-reviewer covers every domain lens", () => {
  it("names all eight, so pipeline.plan can never return a lens it cannot run", () => {
    // `pipeline.plan` returns lens ids from `DOMAIN_LENSES`. A lens the producer
    // does not recognize is a planned review nobody performs -- and a stage that
    // waits on it forever.
    const body = agentFile("eo-domain-reviewer");
    for (const lens of DOMAIN_LENS_IDS) {
      expect(body, `eo-domain-reviewer must document the ${lens} lens`).toContain(lens);
    }
  });

  it("tells the reviewer that an unanswered obligation stalls the stage", () => {
    // The obligation bound treats a silent lens as unmet. A reviewer that does
    // not know this reads the checklist as optional and hangs its own stage.
    expect(agentFile("eo-domain-reviewer")).toMatch(/unanswered obligation|obligation you skip/i);
  });

  it("tells the reviewer that severity does not decide whether the loop continues", () => {
    // Ruling R4. A reviewer still believing advisories are free will file them
    // expecting the stage to close anyway.
    expect(agentFile("eo-domain-reviewer")).toMatch(/advisory holds a stage open/i);
  });
});

describe("eo-documenter", () => {
  it("warns that naming a command which does not exist contradicts the criterion", () => {
    // The one documentation check that catches what a reader cannot: confident
    // prose about a flag nobody shipped.
    expect(agentFile("eo-documenter")).toMatch(/does not exist/i);
  });

  it("states that a worker writes the files, not the manager", () => {
    // §0 amendment 3. A documenter that writes directly bypasses the envelope
    // every other write in this product goes through.
    expect(agentFile("eo-documenter")).toMatch(/worker/i);
  });
});

describe("eo-researcher", () => {
  it("states that fetched content is untrusted input", () => {
    // The safety half of R1. A researcher treating a fetched page as
    // authoritative is how prompt injection reaches a design.
    expect(agentFile("eo-researcher")).toMatch(/untrusted input/i);
  });

  it("states that a web citation needs its retrieval date", () => {
    // The schema refuses one without it; the agent has to know why before it
    // hits the refusal.
    expect(agentFile("eo-researcher")).toMatch(/retriev/i);
  });
});
