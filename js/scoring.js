import { BEST_N_EVENTS } from "./config.js";

// Men's scoring: finish position (1-indexed) → points
// Index 0 is unused so that MEN_SCORING[1] = 200, etc.
export const MEN_SCORING = [
  0,   // placeholder for index 0
  200, 145, 125, 124, 103, 102, 101, 100,
   75,  74,  73,  72,  71,  70,  69,  68,
   48,  47,  46,  45,  44,  43,  42,  41,
   40,  39,  38,  37,  36,  35,  34,  33,
   13,  12,  11,  10
];

// Women's scoring: finish position (1-indexed) → points
export const WOMEN_SCORING = [
  0,   // placeholder for index 0
  250, 225, 200, 190, 135, 130, 125, 120,
   88,  86,  84,  82,  80,  78,  76,  74,
   45,  44,  43,  42,  41,  40,  39,  38
];

/**
 * Look up points for a finish position
 * @param {number} finish - 1-based finish position
 * @param {"mens"|"womens"} tour
 * @returns {number} points (0 if position out of range)
 */
export function getPoints(finish, tour = "mens") {
  const table = tour === "womens" ? WOMEN_SCORING : MEN_SCORING;
  return (finish >= 1 && finish < table.length) ? table[finish] : 0;
}

/**
 * Highest finish position that earns points for a given tour.
 * Hides the (table.length - 1) detail of how the scoring arrays are indexed.
 * @param {"mens"|"womens"} tour
 * @returns {number}
 */
export function getMaxFinishPosition(tour = "mens") {
  const table = tour === "womens" ? WOMEN_SCORING : MEN_SCORING;
  return table.length - 1;
}

/**
 * Score a team for a single event
 * @param {Object} team - team doc with .surfers[] and .alternate
 * @param {Object[]} results - array of result docs for this event
 * @returns {{ totalPoints: number, surferScores: Object[], alternateUsed: boolean, alternateFor: string|null }}
 */
export function scoreTeam(team, results, tour = "mens") {
  if (!team?.surfers?.length) return { totalPoints: 0, surferScores: [], alternateUsed: false, alternateFor: null };
  const resultMap = {};
  results.forEach((r) => { resultMap[r.surferId] = r; });

  const surferScores = [];
  let alternateUsed = false;
  let alternateFor = null;

  for (const s of team.surfers) {
    const result = resultMap[s.surferId];
    if (result && result.withdrawn) {
      // Explicitly marked WDRW — eligible for alternate swap
      surferScores.push({
        surferId: s.surferId,
        finish: null,
        points: 0,
        withdrawn: true
      });
    } else if (result) {
      surferScores.push({
        surferId: s.surferId,
        finish: result.finish,
        points: result.points || getPoints(result.finish, tour)
      });
    } else {
      // No result entered yet — scores 0 but does NOT trigger alternate
      surferScores.push({
        surferId: s.surferId,
        finish: null,
        points: 0
      });
    }
  }

  // Alternate swap: replace first WITHDRAWN surfer only
  if (team.alternate?.surferId) {
    const altResult = resultMap[team.alternate.surferId];
    const missedIdx = surferScores.findIndex((s) => s.withdrawn);
    if (missedIdx !== -1 && altResult && !altResult.withdrawn) {
      alternateUsed = true;
      alternateFor = surferScores[missedIdx].surferId;
      surferScores[missedIdx] = {
        surferId: team.alternate.surferId,
        finish: altResult.finish,
        points: altResult.points || getPoints(altResult.finish, tour),
        isAlternate: true,
        replacedSurferId: alternateFor
      };
    }
  }

  const totalPoints = surferScores.reduce((sum, s) => sum + s.points, 0);

  return { totalPoints, surferScores, alternateUsed, alternateFor };
}

/**
 * Floor (guaranteed-minimum) points for a surfer still competing in an
 * in-progress event. The `aliveCount` surfers still in will occupy places
 * 1..aliveCount; since the points table is non-increasing, the worst a
 * still-alive surfer can finish is place `aliveCount`, so getPoints(aliveCount)
 * is its guaranteed minimum. Using the floor (rather than the mean) guarantees
 * a team's projected total never exceeds its final total — a projected score
 * can only rise as the event unfolds, never fall.
 * @param {number} aliveCount - surfers still competing in the whole event
 * @param {"mens"|"womens"} tour
 * @returns {number} floor points (0 if aliveCount < 1)
 */
export function floorPointsForAlive(aliveCount, tour = "mens") {
  if (!aliveCount || aliveCount < 1) return 0;
  return getPoints(aliveCount, tour);
}

/**
 * Number of surfers still alive in an in-progress event, derived purely from
 * the results recorded so far. Eliminated surfers always occupy the bottom
 * contiguous block of finishing places, so the smallest place assigned to any
 * eliminated surfer equals (aliveCount + 1). If a definitive `fieldSize` is
 * known, alive = fieldSize − (eliminated or withdrawn) is used instead.
 * @param {Object[]} results - result docs for the event
 * @param {number|null} fieldSize - total competitors, if known
 * @returns {number|null} alive count, or null when it can't be derived
 */
export function aliveCountFromResults(results, fieldSize = null) {
  if (fieldSize != null) {
    const out = results.filter((r) => r.withdrawn || Number.isFinite(r.finish)).length;
    return Math.max(0, fieldSize - out);
  }
  const finishes = results
    .filter((r) => !r.withdrawn && Number.isFinite(r.finish))
    .map((r) => r.finish);
  if (!finishes.length) return null;
  return Math.min(...finishes) - 1;
}

/**
 * Project a team's score for an IN-PROGRESS event. Surfers already eliminated
 * contribute their locked-in points; surfers still competing contribute their
 * floor — the guaranteed-minimum points of their worst still-possible finish
 * (see floorPointsForAlive). Using the floor means the projected total is a
 * true lower bound: it can only rise as the event unfolds, never overshoot the
 * final. This exists because scoreTeam() credits 0 to still-alive surfers, which inverts
 * the leaderboard mid-event (teams of early losers temporarily lead). Mirrors
 * scoreTeam's alternate-for-withdrawn substitution. Persisted into the
 * leaderboard for in-progress events by the admin recalc (gated on
 * isInProgress); once the event completes, recalc reverts to scoreTeam.
 * @param {Object} team - team doc with .surfers[] and .alternate
 * @param {Object[]} results - result docs for the event so far
 * @param {"mens"|"womens"} tour
 * @param {number|null} fieldSize - total competitors, if known
 * @returns {{ totalPoints: number, projectedPoints: number, lockedPoints: number, aliveCount: number, surferScores: Object[], alternateUsed: boolean, alternateFor: string|null }}
 */
export function projectTeam(team, results, tour = "mens", fieldSize = null) {
  const empty = { totalPoints: 0, projectedPoints: 0, lockedPoints: 0, aliveCount: 0, surferScores: [], alternateUsed: false, alternateFor: null };
  if (!team?.surfers?.length) return empty;

  const resultMap = {};
  results.forEach((r) => { resultMap[r.surferId] = r; });

  const aliveInEvent = aliveCountFromResults(results, fieldSize);
  // getPoints already returns whole numbers, so the floor needs no rounding.
  const floorAlive = aliveInEvent ? floorPointsForAlive(aliveInEvent, tour) : 0;

  // Scoring contribution + flags for one surferId.
  const evalSurfer = (surferId) => {
    const r = resultMap[surferId];
    if (r && r.withdrawn) return { surferId, finish: null, points: 0, withdrawn: true };
    if (r && Number.isFinite(r.finish)) {
      return { surferId, finish: r.finish, points: r.points || getPoints(r.finish, tour), locked: true };
    }
    // No final result yet → still competing → guaranteed-minimum (floor) upside.
    return { surferId, finish: null, points: floorAlive, projected: true };
  };

  const surferScores = team.surfers.map((s) => evalSurfer(s.surferId));

  // Alternate swaps in for the first WITHDRAWN surfer (mirrors scoreTeam),
  // contributing its own locked-or-projected value.
  let alternateUsed = false;
  let alternateFor = null;
  if (team.alternate?.surferId) {
    const missedIdx = surferScores.findIndex((s) => s.withdrawn);
    if (missedIdx !== -1) {
      const altEval = evalSurfer(team.alternate.surferId);
      if (!altEval.withdrawn) {
        alternateUsed = true;
        alternateFor = surferScores[missedIdx].surferId;
        surferScores[missedIdx] = { ...altEval, isAlternate: true, replacedSurferId: alternateFor };
      }
    }
  }

  const projectedPoints = surferScores.reduce((sum, s) => sum + s.points, 0);
  const lockedPoints = surferScores.reduce((sum, s) => sum + (s.locked ? s.points : 0), 0);

  return {
    totalPoints: projectedPoints,
    projectedPoints,
    lockedPoints,
    aliveCount: surferScores.filter((s) => s.projected).length,
    surferScores,
    alternateUsed,
    alternateFor,
  };
}

/**
 * Whether an event is in progress — i.e. scoring should use projectTeam rather
 * than scoreTeam. status "live" is the canonical signal; a results-bearing
 * event with unfinished rounds also counts; a completed event never does.
 * @param {Object} event
 * @returns {boolean}
 */
export function isInProgress(event) {
  if (!event || event.status === "completed") return false;
  if (event.status === "live") return true;
  if (!event.resultsEntered) return false;
  const done = event.roundsCompleted ?? 0;
  const total = event.totalRounds ?? null;
  return total == null ? false : done < total;
}

/**
 * Best-N total: sum of a competitor's top BEST_N_EVENTS event scores — the
 * single home for the best-9-of-N rule. Copies `scores` before sorting so the
 * caller's array is left untouched.
 * @param {number[]} scores - event point totals, any order
 * @returns {number}
 */
function bestNTotal(scores) {
  return [...scores]
    .sort((a, b) => b - a)
    .slice(0, BEST_N_EVENTS)
    .reduce((a, b) => a + b, 0);
}

/**
 * Calculate season standings using best-9-of-N rule
 * @param {Object[]} entries - array of { userId, displayName, teamName, eventScores: { eventId: pts } }
 * @returns {Object[]} sorted standings
 */
export function calculateSeasonStandings(entries) {
  return entries.map((entry) => {
    const scores = Object.values(entry.eventScores || {});
    return {
      ...entry,
      bestNineTotal: bestNTotal(scores),
      allEventsTotal: scores.reduce((a, b) => a + b, 0),
      eventsPlayed: scores.length
    };
  }).sort((a, b) => {
    // Primary: best 9 total
    if (b.bestNineTotal !== a.bestNineTotal) return b.bestNineTotal - a.bestNineTotal;
    // Tiebreaker: all events total
    if (b.allEventsTotal !== a.allEventsTotal) return b.allEventsTotal - a.allEventsTotal;
    return 0;
  });
}

/**
 * The viewer's rank over time: for each completed event 1..N (in order), rank
 * `userId` within `entries` by best-N total *through that event*. Returns an
 * array of ranks aligned to `completedEventIds` (null where the user has no
 * standing yet). Drives the dashboard / club rank sparkline. `entries` is the
 * already-filtered set whose ranking matters (full leaderboard or one club).
 * @param {Array}    entries            leaderboard entries: { userId, eventScores }
 * @param {string[]} completedEventIds  completed event ids, in chronological order
 * @param {string}   userId             the viewer whose rank to track
 * @returns {(number|null)[]} rank at each event step
 */
export function buildRankProgression(entries, completedEventIds, userId) {
  if (entries.length === 0 || completedEventIds.length === 0) return [];
  const ranks = [];
  for (let n = 1; n <= completedEventIds.length; n++) {
    const evSubset = completedEventIds.slice(0, n);
    const standings = entries.map((e) => {
      const scores = evSubset
        .map((evId) => (e.eventScores || {})[evId] || 0)
        .filter((s) => s > 0);
      return { userId: e.userId, total: bestNTotal(scores) };
    }).sort((a, b) => b.total - a.total);
    const rank = standings.findIndex((s) => s.userId === userId) + 1;
    ranks.push(rank > 0 ? rank : null);
  }
  return ranks;
}
