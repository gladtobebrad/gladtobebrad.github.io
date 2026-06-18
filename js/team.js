/**
 * Team management logic — salary cap validation, team size checks, alternate rules
 */

const TEAM_RULES = {
  mens: { rosterSize: 8, salaryCap: 50_000_000 },
  womens: { rosterSize: 5, salaryCap: 35_000_000 }
};

// Alternate price ceiling — same for both tours. The alternate is excluded from
// the salary cap, so this keeps it a genuine budget bench pick (it can't be used
// to stash a star cap-free). Single source of truth; team.html imports it too.
export const ALT_CAP = 4_000_000;

// No "wildcard" flag exists in the data, so wildcards are identified by price: the
// $1.5M tier (the only value below the $3M ranked floor — see pricing.js's
// WILDCARD_VALUE). Inlined as a literal to avoid a team.js -> pricing.js import
// cycle (pricing.js already imports getTeamRules from here).
const WILDCARD_VALUE = 1_500_000;
const isWildcard = (s) => (s.value || 0) <= WILDCARD_VALUE;

/**
 * Surfer IDs eligible to be picked as the alternate for a tour. Eligible =
 *   • every surfer priced at or under ALT_CAP — this INCLUDES $1.5M wildcards; PLUS
 *   • a cheapest-non-wildcard fallback: if NO non-wildcard surfer is at/under the
 *     cap (e.g. early season, before the bottom of the field has filtered down
 *     toward the $3M floor), the cheapest non-wildcard surfer(s) also become
 *     eligible — so a team can always bench a real surfer, not just a wildcard.
 * Tour-scoped and pure; never changes a value.
 * @param {Object} surferMap - map of surferId -> surfer doc ({ id, value, tour })
 * @param {"mens"|"womens"} tour
 * @returns {Set<string>} eligible surfer ids
 */
export function altEligibleIds(surferMap, tour = "mens") {
  const onTour = Object.values(surferMap || {}).filter((s) => s && (s.tour || "mens") === tour);
  if (onTour.length === 0) return new Set();
  // Everyone at or under the cap is eligible — wildcards ($1.5M) included.
  const eligible = new Set(onTour.filter((s) => (s.value || 0) <= ALT_CAP).map((s) => s.id));
  // Fallback: if NO non-wildcard is at/under the cap, also surface the cheapest
  // non-wildcard(s), so the bench isn't forced to be a wildcard.
  const nonWild = onTour.filter((s) => !isWildcard(s));
  if (nonWild.length && !nonWild.some((s) => (s.value || 0) <= ALT_CAP)) {
    const min = Math.min(...nonWild.map((s) => s.value || 0));
    nonWild.filter((s) => (s.value || 0) === min).forEach((s) => eligible.add(s.id));
  }
  return eligible;
}

/**
 * Validate a team roster
 * @param {Object[]} surfers - array of { surferId, purchasePrice }
 * @param {Object|null} alternate - { surferId, purchasePrice } or null
 * @param {"mens"|"womens"} tour
 * @param {Object} surferData - map of surferId → surfer doc (for alternate price checks)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTeam(surfers, alternate, tour, surferData = {}) {
  const rules = TEAM_RULES[tour] || TEAM_RULES.mens;
  const errors = [];

  // Team size — allow partial rosters, just can't exceed max
  if (surfers.length === 0) {
    errors.push(`Roster must have at least 1 surfer.`);
  }
  if (surfers.length > rules.rosterSize) {
    errors.push(`Roster can have at most ${rules.rosterSize} surfers (currently ${surfers.length}).`);
  }

  // Duplicates
  const ids = surfers.map((s) => s.surferId);
  if (alternate?.surferId) ids.push(alternate.surferId);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    errors.push(`Duplicate surfer(s): ${[...new Set(dupes)].join(", ")}`);
  }

  // Salary cap (alternate excluded)
  const totalSpent = surfers.reduce((sum, s) => sum + (s.purchasePrice || 0), 0);
  if (totalSpent > rules.salaryCap) {
    const over = totalSpent - rules.salaryCap;
    errors.push(`Over salary cap by $${over.toLocaleString()}. Drop a surfer or trade down.`);
  }

  // Alternate eligibility: at/under ALT_CAP, or the cheapest surfer when none
  // qualify (the altEligibleIds fallback — same for both tours).
  if (alternate?.surferId) {
    const altData = surferData[alternate.surferId];
    if (altData && !altEligibleIds(surferData, tour).has(alternate.surferId)) {
      errors.push(`Alternate must be $${ALT_CAP / 1_000_000}M or under (or the cheapest surfer if none qualify). ${altData.name || alternate.surferId} costs ${altData.value ? "$" + (altData.value / 1_000_000).toFixed(2) + "M" : "unknown"}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Calculate remaining salary cap space
 */
export function calculateRemaining(surfers, tour = "mens") {
  const cap = (TEAM_RULES[tour] || TEAM_RULES.mens).salaryCap;
  const spent = surfers.reduce((sum, s) => sum + (s.purchasePrice || 0), 0);
  return cap - spent;
}

/**
 * Get team rules for a tour
 */
export function getTeamRules(tour = "mens") {
  return TEAM_RULES[tour] || TEAM_RULES.mens;
}
