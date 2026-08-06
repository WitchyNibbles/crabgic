/**
 * The snapshot ratchet.
 *
 * WHY A RATCHET AND NOT A GATE. Run the four rules as a blocking check over the
 * corpus as it stands and 324 citations under 129 ticked criteria go red on the
 * first day, overwhelmingly on house convention rather than on defects. A check
 * that cries wolf gets muted, and a muted check is worse than no check because
 * the muting is invisible. So the blocking question is not "is every citation
 * perfect?" — it is **"did this PR move the ground under a citation?"**, which
 * is precisely the measured failure mode: #95, #100, #108, #118 and #119 each
 * inserted lines above text a merged record cited and nothing noticed.
 *
 * The baseline pins, per citation, where every quoted fragment RESOLVED. Legacy
 * drift is seeded as known — visible, counted, burnt down by dated corrections —
 * and any change to a pin fails on the PR that causes it. Repair is one command,
 * and the baseline's own diff (`MOVED@137` → `MOVED@140`) is the drift record a
 * reviewer reads.
 *
 * Two rules do NOT bend, because they cannot be blamed on legacy convention:
 *   - a citation that is NEW or whose `quotedAssertion` was EDITED must resolve
 *     at the line it claims and inside the span it declares. The corpus
 *     therefore converges to machine-checkable form without retrofitting a
 *     single merged record;
 *   - a fragment citing `docs/evidence/**` is quoting a committed transcript.
 *     Those are frozen by the annotate-never-rewrite discipline, so divergence
 *     there is someone editing evidence, and it is reported as that.
 *
 * This file lives in the claim-space (`docs/evidence/criteria-closeout/`) for
 * the same reason `criteria-baseline.json` does: it is bookkeeping about the
 * records, not evidence about the product. **It is never citable.**
 */
import { createHash } from "node:crypto";

export const BASELINE_FILE = "docs/evidence/criteria-closeout/citation-content-baseline.json";
export const SCHEMA_VERSION = 1;

const STALE_PIN = /^(MOVED|MOVED-AMBIG|ABSENT|PAST-EOF|FILE-MISSING)/;

export function shortHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/** Turns a resolved corpus into the committed baseline shape. */
export function buildBaseline(entries, meta) {
  const citations = {};
  for (const entry of [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const pinned = {
      qa: entry.quotedAssertionHash,
      ref: entry.refStatus,
      pins: entry.pins,
    };
    if (entry.frozen) pinned.frozen = true;
    if (entry.declarations !== undefined && entry.declarations.length > 0) {
      pinned.declared = entry.declarations;
    }
    citations[entry.key] = pinned;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: meta.generatedAt,
    generatedAtSha: meta.generatedAtSha,
    note: meta.note,
    counts: meta.counts,
    citations,
  };
}

export function serializeBaseline(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

function samePins(a, b) {
  return a.length === b.length && a.every((pin, index) => pin === b[index]);
}

/** True when a pin means "the pointer is wrong", rather than "it resolved". */
export function isStalePin(pin) {
  return STALE_PIN.test(pin);
}

/** True when a pin means "the text is not inside the span the citation declares". */
export function isOutOfSpanPin(pin) {
  return pin.includes("!span");
}

/**
 * Compares the resolved corpus against the committed baseline.
 *
 * Divergence classes, in the order a reader should act on them:
 *   `unanchored` — a NEW or EDITED citation that does not resolve where it says.
 *                  Not repairable by regenerating the baseline; fix the record.
 *   `regressed`  — a pin that was anchored and is now stale. A PR moved lines
 *                  under a merged citation: this is the whole point of the file.
 *   `drifted`    — a pin that was already stale and has moved again.
 *   `frozen`     — divergence under a `docs/evidence/**` target: committed
 *                  evidence was edited.
 *   `improved`   — a pin that was stale and now resolves. Good news; still needs
 *                  the baseline regenerated, or the baseline would be lying.
 *   `added` / `removed` / `changed` — the baseline no longer describes the
 *                  corpus for any other reason.
 */
export function diffAgainstBaseline(entries, baseline) {
  const divergences = [];
  const seen = new Set();
  for (const entry of entries) {
    seen.add(entry.key);
    const pinned = baseline.citations[entry.key];
    if (pinned === undefined) {
      const bad = entry.pins.filter((pin) => isStalePin(pin) || isOutOfSpanPin(pin));
      divergences.push({
        class: bad.length > 0 ? "unanchored" : "added",
        key: entry.key,
        entry,
        offending: bad,
      });
      continue;
    }
    if (pinned.qa !== entry.quotedAssertionHash) {
      const bad = entry.pins.filter((pin) => isStalePin(pin) || isOutOfSpanPin(pin));
      divergences.push({
        class: bad.length > 0 ? "unanchored" : "added",
        key: entry.key,
        entry,
        offending: bad,
        edited: true,
      });
      continue;
    }
    if (pinned.ref !== entry.refStatus || !samePins(pinned.pins, entry.pins)) {
      const before = pinned.pins;
      const after = entry.pins;
      let divergenceClass = "changed";
      if (entry.frozen) divergenceClass = "frozen";
      else if (before.length === after.length) {
        const regressed = after.some(
          (pin, index) => isStalePin(pin) && !isStalePin(before[index] ?? ""),
        );
        const improved = after.every(
          (pin, index) => !isStalePin(pin) || !isStalePin(before[index] ?? ""),
        );
        if (regressed) divergenceClass = "regressed";
        else if (improved && before.some(isStalePin)) divergenceClass = "improved";
        else divergenceClass = "drifted";
      }
      divergences.push({ class: divergenceClass, key: entry.key, entry, before, after });
    }
  }
  for (const key of Object.keys(baseline.citations)) {
    if (!seen.has(key)) divergences.push({ class: "removed", key });
  }
  return divergences;
}
