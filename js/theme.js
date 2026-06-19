// js/theme.js — runtime Light / Dark / System theme control.
//
// MUST stay in lockstep with the synchronous FOUC snippet in each page's <head>
// (same storage key + same resolve logic), or first paint and runtime disagree.
// The head snippet sets data-theme before paint; this module owns runtime changes
// (the toggle), the System live-switch, and cross-device reconciliation on login.
//
// No imports, no side effects beyond the matchMedia listener — safe to load anywhere.

const KEY = "fsl-theme";
const mq = matchMedia("(prefers-color-scheme: dark)");

/** Stored preference: "light" | "dark" | "system". Absent key = "system". */
export function getStoredTheme() {
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
}

/** Resolve a preference to a concrete theme, honoring the OS for "system". */
function resolve(pref) {
  return pref === "dark" || (pref === "system" && mq.matches) ? "dark" : "light";
}

/** Apply the resolved theme to <html data-theme>. Idempotent. */
export function applyTheme(pref = getStoredTheme()) {
  document.documentElement.setAttribute("data-theme", resolve(pref));
}

/** Set + persist the preference locally, then apply it. "system" clears the key. */
export function setTheme(pref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* private mode — apply for this session only */ }
  applyTheme(pref);
}

/** On login, adopt the account's saved theme ONLY when this device has no explicit
 *  local choice (localStorage always wins first paint). Missing/"system" = no-op. */
export function reconcileTheme(profileTheme) {
  let hasLocal = false;
  try { hasLocal = localStorage.getItem(KEY) != null; } catch { /* ignore */ }
  if (!hasLocal && (profileTheme === "light" || profileTheme === "dark")) {
    setTheme(profileTheme);
  }
}

// "System" live-switch: when the OS theme flips while the user is on System, re-apply.
mq.addEventListener("change", () => {
  if (getStoredTheme() === "system") applyTheme("system");
});
