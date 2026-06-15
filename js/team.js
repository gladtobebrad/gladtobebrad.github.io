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

  // Alternate price ceiling (ALT_CAP — same for both tours).
  if (alternate?.surferId) {
    const altData = surferData[alternate.surferId];
    if (altData && (altData.value || 0) >= ALT_CAP) {
      errors.push(`Alternate must be under $${ALT_CAP / 1_000_000}M. ${altData.name || alternate.surferId} costs ${altData.value ? "$" + (altData.value / 1_000_000).toFixed(2) + "M" : "unknown"}.`);
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
