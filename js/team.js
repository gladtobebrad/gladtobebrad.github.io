/**
 * Team management logic — salary cap validation, team size checks, bracket rules
 */

const TEAM_RULES = {
  mens: { rosterSize: 8, salaryCap: 50_000_000 },
  womens: { rosterSize: 5, salaryCap: 31_000_000 }
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

  // Alternate threshold: $4M for men's, $8M for women's
  const altCap = tour === "womens" ? 5_000_000 : 4_000_000;
  if (alternate?.surferId) {
    const altData = surferData[alternate.surferId];
    if (altData && (altData.value || 0) >= altCap) {
      const capLabel = tour === "womens" ? "$8M" : "$4M";
      errors.push(`Alternate must be under ${capLabel}. ${altData.name || alternate.surferId} costs ${altData.value ? "$" + (altData.value / 1_000_000).toFixed(2) + "M" : "unknown"}.`);
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
