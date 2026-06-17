// js/ui.js — compatibility barrel: a flat re-export over the focused js/ui/*.js
// modules (escape / format / banners / modals / nav). Consumers import everything
// from here; implementations live in js/ui/*. Explicit named re-exports (not
// `export *`) so any future cross-module name collision is a hard error, not a
// silent drop. (Split out of the old 909-line ui.js on 2026-06-18 — F-31 / audit.)
export { escapeHtml, safeUrl } from "./ui/escape.js";
export { nameLabelHtml, padToSparseRoster, formatSalary, formatSalaryFull, formatDate, locationForEvent, statusBadge, tradingBadge, showLoading } from "./ui/format.js";
export { resolveCountdownState, fetchLiveStatusCached, renderLiveStatusBanner, startCountdownTimer } from "./ui/banners.js";
export { toast, confirmModal, showAuthGate } from "./ui/modals.js";
export { renderHeader, renderFooter, bootstrapPage, openProfileEditModal } from "./ui/nav.js";
