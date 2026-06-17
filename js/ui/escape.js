// js/ui/escape.js — HTML / URL sanitisation primitives (the shared leaf; no imports).

// ── Security helpers ─────────────────────────────────

/**
 * Escape a string for safe interpolation into HTML text or a
 * double/single-quoted attribute. Run EVERY user- or remote-sourced
 * value (team/display names, club names, scraped surfer/venue/status
 * strings) through this before placing it in an innerHTML template.
 */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * Validate a URL destined for an <img src> / <a href> attribute.
 * Allows only http(s) absolute URLs and scheme-less same-origin
 * relative paths (e.g. "data/photos/x.png"); returns "" for anything
 * else — javascript:, data:, vbscript:, or protocol-relative //host.
 * Still wrap the result in escapeHtml() when placing it in an attribute.
 */
export function safeUrl(url) {
  const s = String(url ?? "").trim().replace(/[\x00-\x1F]/g, "");
  if (!s || s.startsWith("//")) return "";
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) return /^https?$/i.test(scheme[1]) ? s : "";
  return s; // scheme-less → relative path, same origin
}
