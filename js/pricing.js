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
// Curve: value(rank) = MIN_VALUE + (peak − MIN_VALUE) · decay^(rank−1).
// An exponential taper toward MIN_VALUE: the #1→#2 gap is largest and each
// subsequent gap shrinks by `decay`, so "elite" is worth far more than "very
// good", which is only marginally more than "mid-pack" — mirroring how WSL
// event scoring rewards the very top steeply. MIN_VALUE is the asymptote AND
// the hard floor (so the clamp only ever bites when a downward wiggle would
// push a cheap surfer below it).

export const VALUE_STEP = 250_000;       // every price is a multiple of this
export const MIN_VALUE = 1_500_000;      // hard floor — also the wildcard price
export const MAX_WIGGLE = 750_000;       // cap on the recency nudge (both ways)

// Per-tour anchor context. `peak` is the rank-#1 price (≤ $12.5M by design).
// `poolFactor` scales the target pool total: targetPool = cap·N/starters·factor,
// so at factor 1.0 an average-priced full squad costs exactly the cap. Raise it
// to make the pool richer (cap bites harder, fewer stars affordable); lower it
// to loosen. `starters` is the squad size that counts against the cap (the
// alternate is excluded); `cap` matches TEAM_RULES in team.js.
export const PRICING = {
  mens:   { peak: 12_500_000, starters: 8, cap: 50_000_000, poolFactor: 1.0 },
  womens: { peak: 12_500_000, starters: 5, cap: 35_000_000, poolFactor: 1.0 },
};

const roundToStep = (v, step = VALUE_STEP) => Math.round(v / step) * step;

/** Round to the price step and enforce the hard floor. */
export function clampValue(v) {
  return Math.max(MIN_VALUE, roundToStep(v));
}

// Unrounded pool total for a curve of N ranks: closed form of
// Σ_{r=1..N} [min + (peak−min)·decay^(r−1)].
function poolSum(decay, peak, min, n) {
  const premium = peak - min;
  const geom = decay >= 1 ? n : (1 - Math.pow(decay, n)) / (1 - decay);
  return n * min + premium * geom;
}

// Solve for the decay that makes an N-rank curve sum to `target`. poolSum is
// monotonically increasing in decay, so we binary-search (0,1). If the target
// is outside the achievable range it's clamped to the nearest feasible curve.
function solveDecayForPool(target, peak, min, n, iters = 60) {
  let lo = 0.0001, hi = 0.9999;
  if (target <= poolSum(lo, peak, min, n)) return lo;
  if (target >= poolSum(hi, peak, min, n)) return hi;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (poolSum(mid, peak, min, n) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Build the anchor curve for a tour, sized to N surfers, with `decay` solved so
 * the pool total lands on the tour's target. Call once per repricing, then feed
 * the returned curve to anchorValueForRank. Assumes a roughly full tour: for a
 * tiny N (≤2) the target falls below the curve's own minimum (peak + (N−1)·MIN_VALUE),
 * so `decay` clamps and the pool overshoots / the shape degenerates — irrelevant
 * in practice since repricing only runs against a populated CT ranking.
 * @param {"mens"|"womens"} tour
 * @param {number} n - number of surfers being priced on this tour
 * @returns {{peak:number, min:number, decay:number, n:number, tour:string, targetPool:number}}
 */
export function buildCurve(tour, n) {
  const p = PRICING[tour] || PRICING.mens;
  const targetPool = (p.cap * n / p.starters) * p.poolFactor;
  const decay = solveDecayForPool(targetPool, p.peak, MIN_VALUE, n);
  return { peak: p.peak, min: MIN_VALUE, decay, n, tour, targetPool };
}

/**
 * Anchor price for a season rank on a built curve, rounded and floored.
 * @param {number} rank - 1-based season rank
 * @param {object} curve - from buildCurve()
 * @returns {number|null} price, or null for a non-positive/non-finite rank
 */
export function anchorValueForRank(rank, curve) {
  if (!Number.isFinite(rank) || rank < 1 || !curve) return null;
  const raw = curve.min + (curve.peak - curve.min) * Math.pow(curve.decay, rank - 1);
  return clampValue(raw);
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
