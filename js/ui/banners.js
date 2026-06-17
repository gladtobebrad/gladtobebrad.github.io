// js/ui/banners.js — live-status + countdown banner primitives.
import { escapeHtml } from "./escape.js";

// ── Countdown Banner Helpers ─────────────────────────

/**
 * Pure: resolve which event drives the countdown banner.
 * Ignores siteConfig.showCountdown — caller decides visibility.
 * @returns {{event, deadline, eventName, tour, deadlineSource} | null}
 */
export function resolveCountdownState({ mensEv, womensEv }) {
  const tradingEvents = [mensEv, womensEv].filter((e) => e && e.tradingOpen && e.startDate);
  if (tradingEvents.length === 0) return null;

  const soonest = tradingEvents.reduce((a, b) => {
    const aTime = a.tradingCloseTime || a.startDate;
    const bTime = b.tradingCloseTime || b.startDate;
    return aTime < bTime ? a : b;
  });

  let deadline;
  let deadlineSource;
  if (soonest.tradingCloseTime && soonest.tradingCloseTimezone) {
    const tz = parseFloat(soonest.tradingCloseTimezone);
    const sign = tz >= 0 ? "+" : "-";
    const absH = String(Math.floor(Math.abs(tz))).padStart(2, "0");
    const absM = String(Math.round((Math.abs(tz) % 1) * 60)).padStart(2, "0");
    deadline = new Date(soonest.tradingCloseTime + sign + absH + ":" + absM).getTime();
    deadlineSource = "tradingCloseTime";
  } else {
    deadline = new Date(soonest.startDate + "T00:00:00").getTime();
    deadlineSource = "startDate (fallback)";
  }

  return {
    event: soonest,
    deadline,
    eventName: soonest.name || "the next event",
    tour: soonest.tour || "mens",
    deadlineSource,
  };
}

// Session-cached fetch of WSL's live event status. Bounded to one network
// hit per ~60s window per browser tab so the banner stays near-real-time
// without flooding WSL on every page nav. The wsl-scrape module is loaded
// lazily so non-banner pages don't pay the cost.
//
// WSL outages are non-rare. We enforce a hard timeout (LIVE_STATUS_TIMEOUT_MS)
// so callers never hang waiting on a dead network. On timeout or any other
// failure, we return null AND cache the null with a short TTL so we don't
// retry on every page navigation while WSL is down.
const LIVE_STATUS_TTL_MS = 60_000;
const LIVE_STATUS_FAIL_TTL_MS = 15_000;
const LIVE_STATUS_TIMEOUT_MS = 4_000;
const LIVE_STATUS_KEY = "wsl_live_status";

export async function fetchLiveStatusCached(season) {
  try {
    const cached = sessionStorage.getItem(LIVE_STATUS_KEY);
    if (cached) {
      const { data, fetchedAt, forSeason, ttl } = JSON.parse(cached);
      const ttlMs = ttl || LIVE_STATUS_TTL_MS;
      if (forSeason === season && Date.now() - fetchedAt < ttlMs) {
        return data;
      }
    }
  } catch {}
  let data = null;
  let ttl = LIVE_STATUS_TTL_MS;
  try {
    const { fetchLiveEventStatus } = await import("../wsl-scrape.js");
    data = await Promise.race([
      fetchLiveEventStatus(season),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("WSL fetch timeout")), LIVE_STATUS_TIMEOUT_MS)
      ),
    ]);
  } catch {
    // Network failure, timeout, or parser error — cache null with a short
    // TTL so a transient outage doesn't retry-storm WSL on every nav, but
    // the banner recovers on its own within ~15s of WSL coming back up.
    data = null;
    ttl = LIVE_STATUS_FAIL_TTL_MS;
  }
  try {
    sessionStorage.setItem(
      LIVE_STATUS_KEY,
      JSON.stringify({ data, fetchedAt: Date.now(), forSeason: season, ttl }),
    );
  } catch {}
  return data;
}

/**
 * Paint live-status HTML into el. Returns nothing (no tick — status is
 * mostly static between WSL refreshes). Pass null to clear/hide.
 */
export function renderLiveStatusBanner(el, status) {
  if (!status) {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  // statusColor is scraped from WSL → only allow a bare hex color into the CSS context.
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(status.statusColor || "") ? status.statusColor : "#616161";
  const labelHtml = status.statusLabel
    ? `<span style="display:inline-block;padding:0.1rem 0.6rem;border-radius:4px;background:${safeColor};color:#fff;font-weight:600;font-size:0.78rem;margin-right:0.6rem;vertical-align:middle">${escapeHtml(status.statusLabel)}</span>`
    : "";
  const eventPrefix = status.eventName ? `<strong>${escapeHtml(status.eventName)}:</strong> ` : "";
  const msg = escapeHtml(status.statusMessage || "");
  el.innerHTML = `${labelHtml}${eventPrefix}${msg}`;
  el.style.display = "";
}

/**
 * Paint banner HTML into el and start a 1s tick. Returns the interval id.
 */
export function startCountdownTimer(el, state) {
  const { deadline, eventName } = state;
  el.innerHTML = `First Call for ${eventName} is in <strong class="countdown-timer-text"></strong><br>But trading won't close until the hooter blows`;
  const timerEl = el.querySelector(".countdown-timer-text");
  let intervalId = null;
  const tick = () => {
    const diff = deadline - Date.now();
    if (diff <= 0) {
      el.innerHTML = `First Call for ${eventName} is now <strong>Pending</strong>!<br>But trading won't close until the hooter blows`;
      if (intervalId) clearInterval(intervalId);
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (timerEl) timerEl.textContent = `${d}d : ${h}h : ${m}m : ${s}s`;
  };
  tick();
  intervalId = setInterval(tick, 1000);
  return intervalId;
}
