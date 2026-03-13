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
   45,  40
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
 * Score a team for a single event
 * @param {Object} team - team doc with .surfers[] and .alternate
 * @param {Object[]} results - array of result docs for this event
 * @returns {{ totalPoints: number, surferScores: Object[], alternateUsed: boolean, alternateFor: string|null }}
 */
export function scoreTeam(team, results, tour = "mens") {
  const resultMap = {};
  results.forEach((r) => { resultMap[r.surferId] = r; });

  const surferScores = [];
  let alternateUsed = false;
  let alternateFor = null;

  for (const s of team.surfers) {
    const result = resultMap[s.surferId];
    if (result) {
      surferScores.push({
        surferId: s.surferId,
        finish: result.finish,
        points: result.points || getPoints(result.finish, tour)
      });
    } else {
      // Surfer didn't compete — mark for alternate swap
      surferScores.push({
        surferId: s.surferId,
        finish: null,
        points: 0,
        didNotCompete: true
      });
    }
  }

  // Alternate swap: replace first non-competing surfer's points
  if (team.alternate?.surferId) {
    const altResult = resultMap[team.alternate.surferId];
    const missedIdx = surferScores.findIndex((s) => s.didNotCompete);
    if (missedIdx !== -1 && altResult) {
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
 * Calculate season standings using best-9-of-N rule
 * @param {Object[]} entries - array of { userId, displayName, teamName, eventScores: { eventId: pts } }
 * @returns {Object[]} sorted standings
 */
export function calculateSeasonStandings(entries) {
  return entries.map((entry) => {
    const scores = Object.values(entry.eventScores || {});
    scores.sort((a, b) => b - a);
    const bestNine = scores.slice(0, 9);
    const bestNineTotal = bestNine.reduce((a, b) => a + b, 0);
    const allEventsTotal = scores.reduce((a, b) => a + b, 0);
    return {
      ...entry,
      bestNineTotal,
      allEventsTotal,
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
 * Tiebreaker between two teams for a specific event
 * Compare top-scoring surfer, then second-highest, etc.
 * @returns {number} negative if A wins, positive if B wins, 0 if still tied
 */
export function breakTie(scoresA, scoresB) {
  const a = [...scoresA].sort((x, y) => y - x);
  const b = [...scoresB].sort((x, y) => y - x);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
