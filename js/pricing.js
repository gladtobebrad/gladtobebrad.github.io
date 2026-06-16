// Pure surfer-pricing logic.
//
// Design: a surfer's value is a LOW-PASS-FILTERED (EMA) estimate of their "true
// value", nudged one gentle step toward a rank-based target each event:
//
//     value_t = α · target(rank_t) + (1 − α) · value_{t−1}
//
// — a single-pole low-pass filter. Chosen for inspectability, maintainability,
// and robustness: the target is just "where this rank sits on the curve", α is
// the one smoothness knob, and there is no per-event cap/glide/wiggle stack.
// Early season (when rank is a noisy few-sample estimate) the filter barely
// moves; as the season matures and rank firms up, value converges to the
// target. Big swings are impossible by construction — each move is a fraction of
// the gap, with a small hard backstop (MAX_CHANGE) for the rare large gap.
//
// target(rank): a two-point-pinned curve, peak (rank 1) → RANKED_FLOOR (the
// field's last rank), with `decay` solved so the curve sums to a chosen pool
// total (see buildCurve / solveDecayForPool):
//   target(rank) = RANKED_FLOOR + (peak − RANKED_FLOOR) ·
//     (decay^(rank−1) − decay^(maxRank−1)) / (1 − decay^(maxRank−1))
// The #1→#2 gap is the largest and each subsequent gap shrinks, so "elite" is
// worth far more than "very good". Pinning both ends means the last-ranked
// surfer lands EXACTLY on RANKED_FLOOR ($3M); wildcards sit below at
// WILDCARD_VALUE ($1.5M), nothing between.
//
// Idempotency: repricing is keyed to the most-recent event. Re-running the same
// event recomputes from each surfer's pre-event value (the admin handler stores
// valuePrev/lastPricedEvent), so it never double-steps — robust to multiple
// resolves, unlike a raw EMA.

export const VALUE_STEP = 250_000;       // every price is a multiple of this
export const WILDCARD_VALUE = 1_500_000; // wildcard price — the only value below
                                         // RANKED_FLOOR (nothing sits in between)
export const RANKED_FLOOR = 3_000_000;   // lowest price for a ranked surfer: the
                                         // curve's pinned bottom endpoint (the
                                         // last rank lands here) and clamp floor
export const MAX_VALUE = 12_500_000;     // absolute ceiling (clamp ceiling)
export const ALPHA = 0.5;                // EMA smoothing factor — the one knob:
                                         // higher = faster/larger moves, lower = gentler
export const MAX_CHANGE = 1_500_000;     // hard backstop on per-event movement
                                         // (rarely binds; α keeps moves gentle)

// Per-tour curve context. `peak` is the rank-#1 target price (tuned so the top
// ~5 sit in the $10M ±1M band; capped by MAX_VALUE). `poolFactor` scales the
// target pool total: targetPool = cap·N/starters·factor (N = surfers actually
// repriced), so at factor 1.0 an average-priced full squad costs exactly the
// cap. Raise it to make the pool richer (cap bites harder, fewer stars
// affordable); lower it to loosen. `starters` is the squad size that counts
// against the cap (the alternate is excluded); `cap` matches TEAM_RULES in team.js.
export const PRICING = {
  mens:   { peak: 11_000_000, starters: 8, cap: 50_000_000, poolFactor: 1.0 },
  womens: { peak: 11_000_000, starters: 5, cap: 35_000_000, poolFactor: 0.9 }, // <1.0 required: cap/starters ($7M) = the curve's mid-average, so 1.0 flattens the taper
};

const roundToStep = (v, step = VALUE_STEP) => Math.round(v / step) * step;

/** Round to the price step and clamp to the ranked range [RANKED_FLOOR, MAX_VALUE].
 *  Wildcards sit at WILDCARD_VALUE, below this range, and are never repriced. */
export function clampValue(v) {
  return Math.min(MAX_VALUE, Math.max(RANKED_FLOOR, roundToStep(v)));
}

/**
 * One EMA step: move `prevValue` a fraction α toward `target`, with a hard
 * backstop of MAX_CHANGE so even a big gap (e.g. a brand-new surfer, or a season
 * cold-start) can't lurch. An unpriced surfer (falsy prevValue) seeds straight
 * at the target. Result is rounded to the step and clamped to [RANKED_FLOOR, MAX_VALUE].
 * @param {number} prevValue - the surfer's value before this step (falsy = unpriced)
 * @param {number} target - the rank-based target price (from anchorValueForRank)
 * @param {number} [alpha=ALPHA]
 * @returns {number} the new price
 */
export function emaStep(prevValue, target, alpha = ALPHA) {
  if (!prevValue) return clampValue(target);
  const move = Math.max(-MAX_CHANGE, Math.min(MAX_CHANGE, alpha * (target - prevValue)));
  return clampValue(prevValue + move);
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
 * @returns {{peak:number, floor:number, maxRank:number, decay:number, n:number, tour:string, targetPool:number, degenerate:boolean}}
 */
export function buildCurve(tour, ranks) {
  const p = PRICING[tour] || PRICING.mens;
  const n = ranks.length;
  const maxRank = n ? Math.max(...ranks) : 1;
  const targetPool = (p.cap * n / p.starters) * p.poolFactor;
  const decay = solveDecayForPool(targetPool, p.peak, RANKED_FLOOR, ranks, maxRank);
  // decay pinned at a solver bound ⇒ the target pool is unreachable for this
  // peak/floor/N, so the curve has gone (near-)linear and the taper is lost.
  // Surfaced as a preview warning so a bad peak/poolFactor can't silently regress.
  const degenerate = n > 1 && (decay <= 0.001 || decay >= 0.999);
  return { peak: p.peak, floor: RANKED_FLOOR, maxRank, decay, n, tour, targetPool, degenerate };
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
