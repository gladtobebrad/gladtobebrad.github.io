/**
 * Team management logic — salary cap validation, team size checks, bracket rules
 */

const TEAM_RULES = {
  mens: { rosterSize: 8, salaryCap: 50_000_000 },
  womens: { rosterSize: 5, salaryCap: 30_000_000 }
};

/**
 * Validate a team roster
 * @param {Object[]} surfers - array of { surferId, purchasePrice }
 * @param {Object|null} alternate - { surferId, purchasePrice } or null
 * @param {"mens"|"womens"} tour
 * @param {Object} surferData - map of surferId → surfer doc (for bracket checks)
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

  // Alternate must be budget bracket
  if (alternate?.surferId) {
    const altData = surferData[alternate.surferId];
    if (altData && altData.priceBracket !== "budget") {
      errors.push(`Alternate must be from the budget bracket (< $1M). ${altData.name || alternate.surferId} is ${altData.priceBracket}.`);
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

/**
 * Build a reverted team from the previous event snapshot
 * Restores previous roster with original purchase prices
 */
export function buildRevertTeam(previousTeam) {
  if (!previousTeam) return null;
  return {
    surfers: [...previousTeam.surfers],
    alternate: previousTeam.alternate ? { ...previousTeam.alternate } : null,
    totalSpent: previousTeam.totalSpent
  };
}
