// Pure logic: resolve WSL display names to local surfer IDs, and compute
// final-event finish positions from parsed heat data.
//
// Name matching mirrors scrape_bracket.py's (first_initial, family_name)
// scheme with a generational-suffix carveout. WSL displays "F. Toledo" in
// brackets, our DB stores "Filipe Toledo" — same key.

const GENERATIONAL_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function normalizeName(s) {
  if (!s) return "";
  return s.toLowerCase().replace(/[.,'\-]/g, "").replace(/\s+/g, " ").trim();
}

// "Freddy Patacchia Jr" → "f|patacchia"; "John John Florence" → "j|florence";
// "F. Toledo" → "f|toledo". Returns null if name has fewer than 2 words.
export function nameToKey(name) {
  const cleaned = normalizeName(name);
  if (!cleaned) return null;
  const words = cleaned.split(" ").filter((w) => w);
  if (words.length < 2) return null;
  const init = words[0][0];
  let last = words[words.length - 1];
  if (GENERATIONAL_SUFFIXES.has(last) && words.length >= 3) {
    last = words[words.length - 2];
  }
  return `${init}|${last}`;
}

// Build a key → [surfer, ...] index for one tour. Ambiguous keys (two
// surfers sharing the same first-initial + family name) end up with multiple
// entries; the caller decides how to handle that.
export function buildSurferIndex(surfers, tour) {
  const idx = new Map();
  for (const s of surfers) {
    if ((s.tour || "mens") !== tour) continue;
    const key = nameToKey(s.name);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(s);
  }
  return idx;
}

// Resolve a WSL display name against the index. Returns
// { surfer, ambiguous } or null when nothing matches.
export function resolveSurfer(displayName, index) {
  const key = nameToKey(displayName);
  if (!key) return null;
  const hits = index.get(key);
  if (!hits || hits.length === 0) return null;
  return { surfer: hits[0], ambiguous: hits.length > 1 };
}

// Compute finish positions from a flat heat array (output of
// scrapeEventForGender). Returns { places, warnings } where:
//
//   places   = Map<wslId, { finish, withdrawn, heatTotal }>
//   warnings = string[]
//
// Algorithm — walk rounds high → low. For each fully-completed round:
//   - Final: place 1 = winner, place 2 = loser.
//   - Other: losers (eliminated) sorted by heat total descending, with random
//     tiebreak on exact ties (flagged). Starting place = (count distinct
//     athletes appearing in any round > R) + 1.
//
// Rounds that are not fully completed are skipped — losers there don't get
// a final place yet because heat-total tiebreaks aren't valid until every
// heat in the round is over.
export function computeFinishPositions(heats) {
  const warnings = [];
  const places = new Map();
  if (!heats.length) return { places, warnings };

  const byRound = new Map();
  for (const h of heats) {
    if (h.roundNumber == null) continue;
    if (!byRound.has(h.roundNumber)) byRound.set(h.roundNumber, []);
    byRound.get(h.roundNumber).push(h);
  }
  const roundNums = [...byRound.keys()].sort((a, b) => a - b);
  if (!roundNums.length) return { places, warnings };
  const totalRounds = roundNums[roundNums.length - 1];

  const isRoundComplete = (R) => byRound.get(R).every((h) => h.status === "over");

  // Count of distinct athletes who appeared in any round strictly above R.
  // This is the starting-place offset for round-R losers: they all finished
  // worse than every athlete who advanced past R.
  const athletesAboveCache = new Map();
  function athletesAboveCount(R) {
    if (athletesAboveCache.has(R)) return athletesAboveCache.get(R);
    const set = new Set();
    for (const r of roundNums) {
      if (r <= R) continue;
      for (const h of byRound.get(r)) {
        for (const a of h.athletes) set.add(a.wslId);
      }
    }
    athletesAboveCache.set(R, set.size);
    return set.size;
  }

  for (let R = totalRounds; R >= 1; R--) {
    if (!byRound.has(R)) continue;
    if (!isRoundComplete(R)) continue;

    if (R === totalRounds) {
      // Final — 1 heat, 2 athletes.
      const finalHeats = byRound.get(R);
      if (finalHeats.length !== 1) {
        warnings.push(`Final round has ${finalHeats.length} heats; expected 1.`);
        continue;
      }
      const fh = finalHeats[0];
      const winner = fh.athletes.find((a) => a.advanced || a.placeInHeat === 1);
      const loser = fh.athletes.find((a) => a.eliminated || a.placeInHeat === 2);
      if (winner) places.set(winner.wslId, { finish: 1, withdrawn: false, heatTotal: winner.heatTotal });
      if (loser) places.set(loser.wslId, { finish: 2, withdrawn: false, heatTotal: loser.heatTotal });
      continue;
    }

    // Non-final round — collect every eliminated athlete from this round.
    const losers = [];
    for (const h of byRound.get(R)) {
      for (const a of h.athletes) {
        if (a.advanced) continue;
        if (!a.eliminated && a.placeInHeat === 1) continue; // defensive
        losers.push(a);
      }
    }

    // Flag exact-tie groups before shuffling so the admin knows to verify.
    const byScore = new Map();
    for (const l of losers) {
      const k = l.heatTotal;
      if (!byScore.has(k)) byScore.set(k, []);
      byScore.get(k).push(l);
    }
    for (const [score, group] of byScore) {
      if (group.length > 1 && score != null) {
        warnings.push(
          `R${R} heat-total tie at ${score.toFixed(2)}: ${group.map((l) => l.displayName).join(", ")} — order picked randomly; verify and swap if needed.`,
        );
      }
    }

    losers.sort((a, b) => {
      const at = a.heatTotal ?? -Infinity;
      const bt = b.heatTotal ?? -Infinity;
      if (at !== bt) return bt - at;
      return Math.random() - 0.5;
    });

    const startingPlace = athletesAboveCount(R) + 1;
    losers.forEach((l, i) => {
      places.set(l.wslId, {
        finish: startingPlace + i,
        withdrawn: false,
        heatTotal: l.heatTotal,
      });
    });
  }

  // Flag zero-score athletes as possible-withdrawal candidates. WSL marks
  // actual withdrawals with a separate signal we haven't pinned down yet,
  // so for now we just surface them and let the admin set WDRW manually.
  for (const r of roundNums) {
    for (const h of byRound.get(r)) {
      for (const a of h.athletes) {
        if (a.heatTotal === 0 && places.has(a.wslId)) {
          warnings.push(
            `${a.displayName} (R${r} ${h.heatName}) scored 0.00 — possibly withdrew? Verify and set to WDRW manually if so.`,
          );
        }
      }
    }
  }

  return { places, warnings };
}
