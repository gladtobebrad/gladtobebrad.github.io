// ── App-wide configuration ───────────────────────────
//
// Single source of truth for season-wide constants. Importing from here
// (instead of re-declaring `const SEASON = 2026` in every page) means a season
// rollover is a one-line edit, and the live banners can no longer drift from the
// page bodies — ui.js previously derived the season from `new Date().getFullYear()`,
// which would silently disagree with the pages on Jan 1.
//
// This module has no dependencies and no side effects, so any layer may import it.

// The active competition season. Bump this once at season rollover.
export const SEASON = 2026;

// Season standings use the best N of however many events run.
export const BEST_N_EVENTS = 9;

// The tours the league runs. Prefer importing TOURS over re-typing the
// ["mens", "womens"] array literal.
export const TOURS = ["mens", "womens"];


// ── Tour display labels ──────────────────────────────
// The display projection of the TOURS ids. Convention: anything not "womens"
// reads as men's (matches the `tour || "mens"` default used across the app).

/** Bare tour label → "Women's" / "Men's". */
export function tourLabel(tour) {
  return tour === "womens" ? "Women's" : "Men's";
}

/** Tour label with the Championship-Tour suffix → "Women's CT" / "Men's CT". */
export function tourLabelFull(tour) {
  return tour === "womens" ? "Women's CT" : "Men's CT";
}

/** Single-char tour code for tight cells → "W" / "M". */
export function tourAbbr(tour) {
  return tour === "womens" ? "W" : "M";
}
