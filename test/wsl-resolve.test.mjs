// Regression test for computeFinishPositions — focuses on the DETERMINISTIC
// exact-heat-total tiebreak (replacing the old Math.random() shuffle, which made
// re-running a scrape reshuffle tied surfers). wsl-resolve.js is a pure module,
// so we import it directly.
import { computeFinishPositions } from "../js/wsl-resolve.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`❌ ${label}\n   got:  ${g}\n   want: ${w}`); }
};
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`❌ ${label}`); } };

// Synthetic 2-round bracket. Round 1 (semis): two heats whose ELIMINATED surfers
// (C, D) share an EXACT heat total (10.0) → the tie the old code shuffled.
// Round 2 (final): A beats B.
const athlete = (wslId, { adv = false, elim = false, place, total, name }) => ({
  wslId, advanced: adv, eliminated: elim, placeInHeat: place, heatTotal: total, displayName: name,
});
const makeHeats = () => [
  { roundNumber: 1, status: "over", athletes: [
    athlete("a1", { adv: true,  place: 1, total: 15.0, name: "A" }),
    athlete("c1", { elim: true, place: 2, total: 10.0, name: "C" }),
  ]},
  { roundNumber: 1, status: "over", athletes: [
    athlete("b1", { adv: true,  place: 1, total: 14.0, name: "B" }),
    athlete("d1", { elim: true, place: 2, total: 10.0, name: "D" }),
  ]},
  { roundNumber: 2, status: "over", athletes: [
    athlete("a1", { adv: true,  place: 1, total: 17.0, name: "A" }),
    athlete("b1", { elim: true, place: 2, total: 16.0, name: "B" }),
  ]},
];

// Determinism: run 30× and confirm the placement is identical each time.
const snapshot = () => {
  const { places } = computeFinishPositions(makeHeats(), 2);
  return [...places.entries()].map(([id, p]) => `${id}:${p.finish}`).sort().join("|");
};
const first = snapshot();
let allSame = true;
for (let i = 0; i < 30; i++) { if (snapshot() !== first) allSame = false; }
ok("deterministic across 30 runs (no Math.random churn)", allSame);

// Correct placements: A=1, B=2; the tied C/D get 3 & 4 ordered by stable wslId.
const { places, warnings } = computeFinishPositions(makeHeats(), 2);
eq("A (final winner) → 1", places.get("a1")?.finish, 1);
eq("B (final loser) → 2", places.get("b1")?.finish, 2);
eq("C (tied, wslId c1 < d1) → 3", places.get("c1")?.finish, 3);
eq("D (tied, wslId d1) → 4", places.get("d1")?.finish, 4);
ok("exact tie is still flagged for admin review", warnings.some((w) => /tie/i.test(w)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
