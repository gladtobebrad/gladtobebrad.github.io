// js/ui/format.js — pure presentational helpers (names, salary/date/venue, badges, loading).
import { escapeHtml } from "./escape.js";

// ── Surfer-name rendering ────────────────────────────

// Split a full name into { first, last } — the last word is the surname, the
// rest the given name(s). Internal helper for the two-line surfer-tile labels.
function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: "", last: parts[0] };
  const last = parts.pop();
  return { first: parts.join(" "), last };
}

// Two-line surfer-tile name label: small given name over a larger surname.
// Shared by the dashboard (index) and My Team roster strips.
export function nameLabelHtml(fullName) {
  const { first, last } = splitName(fullName);
  return `<span class="team-row__name">
    ${first ? `<span class="team-row__firstname">${escapeHtml(first)}</span>` : ""}
    <span class="team-row__lastname">${escapeHtml(last || fullName)}</span>
  </span>`;
}

// ── Sparse Roster Helper ─────────────────────────────

/**
 * Inflate a saved (possibly compact) surfers array into a fixed-size
 * sparse array of length `size`, with `null` in any empty slot. Each
 * saved surfer may carry a `team_position` field that controls its
 * sparse index; if absent, the surfer falls back to the order it
 * appears in the saved array (legacy compact-storage behaviour).
 *
 * Used by the editable Your Roster strip, the Dashboard's read-only
 * team strip, and the prior-rosters strip on My Team so they all
 * render saved teams identically — gaps preserved when present.
 *
 * @param {Array} saved   array of { surferId, purchasePrice, [team_position] }
 * @param {number} size   target sparse length (rosterSize)
 * @returns {Array}       sparse array of length `size`
 */
export function padToSparseRoster(saved, size) {
  const out = new Array(size).fill(null);
  (saved || []).forEach((s, i) => {
    if (!s) return;
    const pos = (typeof s.team_position === "number" && s.team_position >= 0 && s.team_position < size)
      ? s.team_position
      : i;
    if (pos < size && out[pos] === null) out[pos] = s;
  });
  return out;
}

// ── Formatting Helpers ───────────────────────────────

/** Format a number as currency: $1,500,000 → "$1.5M" */
export function formatSalary(value) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

/** Format salary as full number: $1,500,000 */
export function formatSalaryFull(value) {
  return `$${value.toLocaleString()}`;
}

/** Format a Firestore timestamp or ISO string as readable date */
export function formatDate(val) {
  if (!val) return "—";
  const date = val.toDate ? val.toDate() : new Date(val);
  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

// ── Short event names (surf venue) ───────────────────────
// Maps full WSL event names ("Lexus Pipe Pro") to the short venue label
// ("Pipeline") used for compact column headers. Shared by surfers.html,
// standings.html, and club.html.
const LOCATION_MAP = {
  "Lexus Pipe Pro":                          "Pipeline",
  "Billabong Pro Pipeline":                  "Pipeline",
  "Hurley Pro Sunset Beach":                 "Sunset Beach",
  "Surf Abu Dhabi Pro":                      "Abu Dhabi",
  "MEO Rip Curl Pro Portugal":               "Portugal",
  "MEO Portugal Pro":                        "Portugal",
  "Surf City El Salvador Pro":               "El Salvador",
  "Rip Curl Pro Bells Beach":                "Bells Beach",
  "Bonsoy Gold Coast Pro":                   "Gold Coast",
  "Western Australia Margaret River Pro":    "Margaret River",
  "Margaret River Pro":                      "Margaret River",
  "Lexus Trestles Pro":                      "Trestles",
  "VIVO Rio Pro":                            "Rio",
  "Oi Rio Pro":                              "Rio",
  "Corona Open J-Bay":                       "J-Bay",
  "Corona Cero Open J-Bay":                  "J-Bay",
  "SHISEIDO Tahiti Pro":                     "Tahiti",
  "Outerknown Tahiti Pro":                   "Tahiti",
  "Lexus Tahiti Pro":                        "Tahiti",
  "Tahiti Pro":                              "Tahiti",
  "Corona Fiji Pro":                         "Fiji",
  "Fiji Pro":                                "Fiji",
  "Corona Cero New Zealand Pro":             "New Zealand",
  "Lexus Pipe Masters":                      "Pipeline",
  "Lexus WSL Finals":                        "WSL Finals",
  "Rip Curl WSL Finals":                     "WSL Finals",
  "Lexus WSL Finals Fiji":                   "WSL Finals",
  "Surf Ranch Pro":                          "Surf Ranch",
  "Quiksilver/ROXY Pro G-Land":              "G-Land",
};

const LOCATION_PATTERNS = [
  { re: /\bpipe/i, loc: "Pipeline" },
  { re: /\bsunset\b/i, loc: "Sunset Beach" },
  { re: /\babu\s+dhabi\b/i, loc: "Abu Dhabi" },
  { re: /\bportugal\b/i, loc: "Portugal" },
  { re: /\bel\s+salvador\b/i, loc: "El Salvador" },
  { re: /\bbells\b/i, loc: "Bells Beach" },
  { re: /\bgold\s+coast\b/i, loc: "Gold Coast" },
  { re: /\bmargaret\s+river\b/i, loc: "Margaret River" },
  { re: /\btrestles\b/i, loc: "Trestles" },
  { re: /\brio\b/i, loc: "Rio" },
  { re: /\bj-?bay\b/i, loc: "J-Bay" },
  { re: /\btahiti\b/i, loc: "Tahiti" },
  { re: /\bfiji\b/i, loc: "Fiji" },
  { re: /\bfinals\b/i, loc: "WSL Finals" },
  { re: /\bsurf\s+ranch\b/i, loc: "Surf Ranch" },
  { re: /\bg-?land\b/i, loc: "G-Land" },
  { re: /\bnew\s*zealand\b/i, loc: "New Zealand" },
];

/** Short venue label for a full WSL event name (e.g. "Lexus Pipe Pro" → "Pipeline"). */
export function locationForEvent(eventName) {
  if (!eventName) return eventName;
  const exact = LOCATION_MAP[eventName];
  if (exact) return exact;
  for (const { re, loc } of LOCATION_PATTERNS) {
    if (re.test(eventName)) return loc;
  }
  return eventName;
}

/** Event status badge HTML */
export function statusBadge(status) {
  const labels = {
    upcoming: "Upcoming",
    live: "Live",
    completed: "Completed"
  };
  return `<span class="badge badge--${status}">${labels[status] || status}</span>`;
}

/** Trading status badge */
export function tradingBadge(open) {
  return open
    ? `<span class="badge badge--open">Trading Open</span>`
    : `<span class="badge badge--locked">Trading Locked</span>`;
}

// ── Loading State ────────────────────────────────────

export function showLoading(container) {
  container.style.cssText = "";
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
}
