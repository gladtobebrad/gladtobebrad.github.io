// Pure surfer-pricing logic.
//
// Design: prices are ANCHORED to a surfer's live WSL season rank, not evolved
// step-by-step from the previous price. An anchor (target function) is
// self-correcting — re-derived from rank every cycle — so it can't drift or
// accumulate the rounding/floor bias an incremental "delta from last price"
// scheme suffers. It also lets us MANAGE THE POOL TOTAL directly: the sum of a
// curve over a fixed set of ranks is analytic, so we pick the total we want
// and solve the curve to hit it (see buildCurve / solveDecayForPool).
//
// On top of the anchor we add a small bounded "wiggle": a recency nudge for a
// notably strong/weak result in the most recent event. The anchor always
// dominates, so form colours a price without un-anchoring it from standing.
//
// Curve: an exponential taper from `peak` (rank 1) down to RANKED_FLOOR (the
// field's last rank) — BOTH ends pinned — with `decay` setting the curvature:
//   value(rank) = RANKED_FLOOR + (peak − RANKED_FLOOR) ·
//     (decay^(rank−1) − decay^(maxRank−1)) / (1 − decay^(maxRank−1))
// The #1→#2 gap is the largest and each subsequent gap shrinks, so "elite" is
// worth far more than "very good" (only marginally more than "mid-pack") —
// mirroring how WSL event scoring rewards the very top steeply. Pinning both
// ends means the lowest-ranked surfer lands EXACTLY on RANKED_FLOOR ($3M), not
// merely near it; wildcards sit below at WILDCARD_VALUE ($1.5M), nothing between.

export const VALUE_STEP = 250_000;       // every price is a multiple of this
export const WILDCARD_VALUE = 1_500_000; // wildcard price — the only value below
                                         // RANKED_FLOOR (nothing sits in between)
export const RANKED_FLOOR = 3_000_000;   // lowest price for a ranked surfer; the
                                         // curve's asymptote and clamp floor
export const MAX_VALUE = 12_500_000;     // absolute ceiling — reserved for a top
                                         // rank on a heater (anchor + wiggle)
export const MAX_WIGGLE = 500_000;       // cap on the recency nudge (both ways)
export const MAX_CHANGE = 2_000_000;     // hard cap on price movement per cycle

// Per-tour anchor context. `peak` is the rank-#1 ANCHOR price (tuned so the top
// ~5 sit in the $10M ±1M band); the absolute price a surfer can reach (anchor +
// wiggle) is capped at MAX_VALUE, reserved for a top rank on a heater.
// `poolFactor` scales the target pool total: targetPool = cap·N/starters·factor
// (N = surfers actually being repriced), so at factor 1.0 an average-priced full
// squad costs exactly the cap. Raise it to make the pool richer (cap bites
// harder, fewer stars affordable); lower it to loosen. `starters` is the squad
// size that counts against the cap (the alternate is excluded); `cap` matches
// TEAM_RULES in team.js.
export const PRICING = {
  mens:   { peak: 11_000_000, starters: 8, cap: 50_000_000, poolFactor: 1.0 },
  womens: { peak: 11_000_000, starters: 5, cap: 35_000_000, poolFactor: 1.0 },
};

const roundToStep = (v, step = VALUE_STEP) => Math.round(v / step) * step;

/** Round to the price step and clamp to the ranked range [RANKED_FLOOR, MAX_VALUE].
 *  Wildcards sit at WILDCARD_VALUE, below this range, and are never repriced. */
export function clampValue(v) {
  return Math.min(MAX_VALUE, Math.max(RANKED_FLOOR, roundToStep(v)));
}

/**
 * Limit how far a price may move in one repricing cycle. The anchor is the
 * eventual target; we step toward it by at most MAX_CHANGE so prices glide over
 * a few events rather than jump. In steady state the only recurring move is the
 * wiggle (≤ MAX_WIGGLE), so per-cycle changes above $1M are rare and above $2M
 * impossible; the first reprice off hand-set prices is the one-time exception
 * that converges across cycles. A brand-new (unpriced) surfer starts at target.
 * @param {number} oldValue - current stored price (falsy = unpriced)
 * @param {number} target - desired price (clamped anchor + wiggle)
 * @returns {number} new price, within ±MAX_CHANGE of oldValue (and floor/ceiling)
 */
export function cappedValue(oldValue, target) {
  if (!oldValue) return clampValue(target);
  const step = Math.max(-MAX_CHANGE, Math.min(MAX_CHANGE, target - oldValue));
  return clampValue(oldValue + step);
}

// Weight for `rank` on the two-point-pinned curve: 1 at rank 1, 0 at maxRank, so
// value = floor + (peak − floor) · weight gives peak at the top and exactly the
// floor at the field's last rank.
function curveWeight(decay, rank, maxRank) {
  if (maxRank <= 1) return rank <= 1 ? 1 : 0;
  const tail = Math.pow(decay, maxRank - 1);
  const denom = 1 - tail;
  if (denom === 0) return 0;
  return (Math.pow(decay, rank - 1) - tail) / denom;
}

// Unrounded pool total over the ACTUAL ranks being priced (which may be sparse),
// not 1..N — so the target reflects exactly the surfers we reprice; non-CT /
// unmatched surfers never enter the curve.
function poolSum(decay, peak, floor, ranks, maxRank) {
  const span = peak - floor;
  let total = 0;
  for (const r of ranks) total += floor + span * curveWeight(decay, r, maxRank);
  return total;
}

// Solve for the decay that makes the curve sum to `target` over `ranks`. poolSum
// is monotonically non-decreasing in decay, so we binary-search (0,1). If the
// target is outside the achievable range it's clamped to the nearest feasible curve.
function solveDecayForPool(target, peak, floor, ranks, maxRank, iters = 60) {
  let lo = 0.0001, hi = 0.9999;
  if (target <= poolSum(lo, peak, floor, ranks, maxRank)) return lo;
  if (target >= poolSum(hi, peak, floor, ranks, maxRank)) return hi;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (poolSum(mid, peak, floor, ranks, maxRank) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Build the anchor curve for a tour from the ranks actually being priced. The
 * curve is pinned at `peak` (rank 1) and RANKED_FLOOR (the field's last rank);
 * the free `decay` is solved so the anchors sum to the tour's target pool. Call
 * once per repricing, then feed the returned curve to anchorValueForRank. For a
 * degenerate field (≤1 rank) the curve collapses to `peak` — irrelevant in
 * practice since repricing only runs against a populated CT ranking.
 * @param {"mens"|"womens"} tour
 * @param {number[]} ranks - season ranks of the surfers being priced (may be sparse)
 * @returns {{peak:number, floor:number, maxRank:number, decay:number, n:number, tour:string, targetPool:number}}
 */
export function buildCurve(tour, ranks) {
  const p = PRICING[tour] || PRICING.mens;
  const n = ranks.length;
  const maxRank = n ? Math.max(...ranks) : 1;
  const targetPool = (p.cap * n / p.starters) * p.poolFactor;
  const decay = solveDecayForPool(targetPool, p.peak, RANKED_FLOOR, ranks, maxRank);
  return { peak: p.peak, floor: RANKED_FLOOR, maxRank, decay, n, tour, targetPool };
}

/**
 * Anchor price for a season rank on a built curve, rounded and floored.
 * @param {number} rank - 1-based season rank
 * @param {object} curve - from buildCurve()
 * @returns {number|null} price, or null for a non-positive/non-finite rank
 */
export function anchorValueForRank(rank, curve) {
  if (!Number.isFinite(rank) || rank < 1 || !curve) return null;
  const w = curveWeight(curve.decay, rank, curve.maxRank);
  return clampValue(curve.floor + (curve.peak - curve.floor) * w);
}

// Bounded recency nudge, keyed off how far the latest event finish beat (or
// missed) the surfer's current season rank. Buckets mirror the old repricing
// scale so the feel is familiar; capped at MAX_WIGGLE.
const WIGGLE_BUCKETS = [
  { within: 2, amount: 0 },
  { within: 6, amount: 250_000 },
  { within: 12, amount: 500_000 },
  { within: Infinity, amount: MAX_WIGGLE },
];

/**
 * Recency wiggle for one surfer. delta = rank − finish (positive = finished
 * better than their season rank in the latest event → price up).
 * @param {number} rank
 * @param {number} finish
 * @returns {number} signed dollar nudge (0 if either input is missing)
 */
export function eventWiggle(rank, finish) {
  if (!Number.isFinite(rank) || !Number.isFinite(finish)) return 0;
  const delta = rank - finish;
  const mag = WIGGLE_BUCKETS.find((b) => Math.abs(delta) <= b.within).amount;
  return delta > 0 ? mag : delta < 0 ? -mag : 0;
}

/**
 * Cap-tenability snapshot for a set of proposed prices. Answers "is the pool
 * still buildable but not floodable?" and "did we hit the target pool total?"
 * @param {number[]} values - proposed prices for every surfer on the tour
 * @param {"mens"|"womens"} tour
 * @returns {{starters:number, cap:number, topStartersSum:number, affordableStars:number, poolTotal:number, targetPool:number}}
 *   - topStartersSum  : cost of the `starters` most expensive surfers
 *   - affordableStars : how many of the priciest you could roster and still
 *                       fill the remaining slots with the cheapest surfers
 *                       under the cap (want this comfortably below `starters`)
 *   - poolTotal       : actual sum of `values` (post-rounding)
 *   - targetPool      : the total the curve was solved to hit
 */
export function tenabilityReport(values, tour = "mens") {
  const p = PRICING[tour] || PRICING.mens;
  const n = values.length;
  const desc = [...values].sort((a, b) => b - a);
  const asc = [...values].sort((a, b) => a - b);
  const topStartersSum = desc.slice(0, p.starters).reduce((a, b) => a + b, 0);

  let affordableStars = 0;
  for (let k = p.starters; k >= 0; k--) {
    const stars = desc.slice(0, k).reduce((a, b) => a + b, 0);
    const fill = asc.slice(0, p.starters - k).reduce((a, b) => a + b, 0);
    if (stars + fill <= p.cap) { affordableStars = k; break; }
  }

  return {
    starters: p.starters,
    cap: p.cap,
    topStartersSum,
    affordableStars,
    poolTotal: values.reduce((a, b) => a + b, 0),
    targetPool: (p.cap * n / p.starters) * p.poolFactor,
  };
}
