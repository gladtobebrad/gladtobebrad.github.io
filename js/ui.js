import { getCurrentUser, getUserProfile, signIn, signOut, onAuth, signInWithEmail, registerWithEmail, resetPassword } from "./auth.js";

// ── Navigation ───────────────────────────────────────

const NAV_ITEMS = [
  { title: "Dashboard", href: "index.html" },
  { title: "My Team", href: "team.html" },
  { title: "Clubhouse", href: "club.html" },
  { title: "Data Vault", href: "surfers.html" },
  { title: "About", href: "about.html" },
];

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
const LIVE_STATUS_TTL_MS = 60_000;
const LIVE_STATUS_KEY = "wsl_live_status";

export async function fetchLiveStatusCached(season) {
  try {
    const cached = sessionStorage.getItem(LIVE_STATUS_KEY);
    if (cached) {
      const { data, fetchedAt, forSeason } = JSON.parse(cached);
      if (forSeason === season && Date.now() - fetchedAt < LIVE_STATUS_TTL_MS) {
        return data;
      }
    }
  } catch {}
  try {
    const { fetchLiveEventStatus } = await import("./wsl-scrape.js");
    const data = await fetchLiveEventStatus(season);
    try {
      sessionStorage.setItem(
        LIVE_STATUS_KEY,
        JSON.stringify({ data, fetchedAt: Date.now(), forSeason: season }),
      );
    } catch {}
    return data;
  } catch {
    // WSL fetch failed — return null so banner just doesn't render. Don't
    // cache the failure: next call will retry.
    return null;
  }
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
  const labelHtml = status.statusLabel
    ? `<span style="display:inline-block;padding:0.1rem 0.6rem;border-radius:4px;background:${status.statusColor || "#616161"};color:#fff;font-weight:600;font-size:0.78rem;margin-right:0.6rem;vertical-align:middle">${status.statusLabel}</span>`
    : "";
  const eventPrefix = status.eventName ? `<strong>${status.eventName}:</strong> ` : "";
  const msg = status.statusMessage || "";
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

/**
 * Render the shared header/nav into an element with id="app-header"
 */
export function renderHeader() {
  const header = document.getElementById("app-header");
  if (!header) return;

  header.innerHTML = `
    <div class="nav-inner">
      <a href="index.html" class="nav-brand" id="nav-brand-link">
        <img src="img/Fsurf_logo_with_text.png" alt="Fantasy Surfer" style="height:26px;display:block;">
      </a>
      <button class="nav-toggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-links" id="nav-links">
        ${NAV_ITEMS.map((item) =>
          `<li><a href="${item.href}"${item.id ? ` id="${item.id}"` : ""}>${item.title}</a></li>`
        ).join("")}
      </ul>
      <div class="nav-auth" id="nav-auth"></div>
    </div>
  `;

  // Banners (inserted after header). Two slots; only one is shown at a time
  // — live takes priority over countdown when active.
  let liveStatusEl = document.getElementById("live-status-banner");
  if (!liveStatusEl) {
    liveStatusEl = document.createElement("div");
    liveStatusEl.id = "live-status-banner";
    liveStatusEl.style.cssText = "display:none;text-align:center;padding:0.4rem 1rem;background:rgba(33,122,60,0.12);font-size:0.85rem;color:var(--color-charcoal)";
    header.parentNode.insertBefore(liveStatusEl, header.nextSibling);
  }
  let countdownEl = document.getElementById("trading-countdown");
  if (!countdownEl) {
    countdownEl = document.createElement("div");
    countdownEl.id = "trading-countdown";
    countdownEl.style.cssText = "display:none;text-align:center;padding:0.4rem 1rem;background:rgba(192,57,43,0.12);font-size:0.85rem;color:var(--color-charcoal)";
    header.parentNode.insertBefore(countdownEl, liveStatusEl.nextSibling);
  }

  // Hamburger toggle
  const toggle = header.querySelector(".nav-toggle");
  const links = header.querySelector(".nav-links");
  toggle?.addEventListener("click", () => {
    links.classList.toggle("open");
  });

  // Auth state UI
  onAuth(async (user, profile) => {
    const authEl = document.getElementById("nav-auth");
    if (!authEl) return;
    if (user) {
      const brandLink = document.getElementById("nav-brand-link");
      if (brandLink) brandLink.href = "index.html";
      const photoSrc = profile?.avatarUrl || user.photoURL;
      const photo = photoSrc
        ? `<img src="${photoSrc}" alt="" class="nav-avatar" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
        : "";
      const adminLink = profile?.isAdmin
        ? `<a href="admin.html" class="nav-admin-link">Admin</a>`
        : "";
      authEl.innerHTML = `
        ${adminLink}
        ${photo}
        <span class="nav-user-name">${user.displayName || "User"}</span>
        <button class="btn btn--sm btn--outline" id="btn-signout">Sign Out</button>
      `;
      document.getElementById("btn-signout")?.addEventListener("click", signOut);

      // Banners: fetch the live-status (cached) and the countdown inputs in
      // parallel. Live banner takes priority — if WSL reports an active
      // event and the admin hasn't hidden it, show it and suppress the
      // countdown. Otherwise fall back to the countdown if eligible.
      try {
        const { getCurrentEventForTour, getSiteConfig } = await import("./db.js");
        const SEASON = new Date().getFullYear();
        const [mensEv, womensEv, siteConfig, liveStatus] = await Promise.all([
          getCurrentEventForTour("mens", SEASON),
          getCurrentEventForTour("womens", SEASON),
          getSiteConfig(),
          fetchLiveStatusCached(SEASON),
        ]);
        if (window._countdownInterval) clearInterval(window._countdownInterval);

        const showLive = siteConfig.showLiveStatus !== false && !!liveStatus;
        if (showLive) {
          renderLiveStatusBanner(liveStatusEl, liveStatus);
          countdownEl.style.display = "none";
        } else {
          renderLiveStatusBanner(liveStatusEl, null);
          const state = resolveCountdownState({ mensEv, womensEv });
          if (siteConfig.showCountdown === false || !state) {
            countdownEl.style.display = "none";
          } else {
            countdownEl.style.display = "";
            window._countdownInterval = startCountdownTimer(countdownEl, state);
          }
        }
      } catch (e) { /* silently skip banners if fetch fails */ }
    } else {
      renderLiveStatusBanner(liveStatusEl, null);
      countdownEl.style.display = "none";
      authEl.innerHTML = `
        <button class="btn btn--sm btn--primary" id="btn-signin">Sign In with Google</button>
      `;
      document.getElementById("btn-signin")?.addEventListener("click", signIn);
    }
  });
}

/**
 * Render the shared footer into an element with id="app-footer"
 */
export function renderFooter() {
  const footer = document.getElementById("app-footer");
  if (!footer) return;
  footer.innerHTML = `
    <div class="footer-inner">
      <p>Fantasy Surf League</p>
      <p class="footer-sub">Not affiliated with the World Surf League.</p>
    </div>
  `;
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

// ── Toast Notifications ──────────────────────────────

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
}

/**
 * Show a toast notification
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} duration - ms
 */
export function toast(message, type = "info", duration = 3500) {
  ensureToastContainer();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  // Trigger animation
  requestAnimationFrame(() => el.classList.add("toast--visible"));
  setTimeout(() => {
    el.classList.remove("toast--visible");
    el.addEventListener("transitionend", () => el.remove());
  }, duration);
}

// ── Confirm Modal ────────────────────────────────────

/**
 * Themed replacement for window.confirm. Resolves true on confirm,
 * false on cancel/ESC/backdrop click.
 * `bodyHtml` may contain HTML (caller controls escaping).
 */
export function confirmModal({
  title,
  bodyHtml,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  confirmTone = "primary",
  steps = null,        // array of step labels, e.g. ["Lock trading", "Carry forward", "Popularity"]
  currentStep = 1      // 1-based index into `steps`
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    let stepsHtml = "";
    if (Array.isArray(steps) && steps.length > 1) {
      stepsHtml = `<ol class="confirm-modal__steps">${steps.map((label, i) => {
        const n = i + 1;
        const stateClass = n < currentStep ? " confirm-modal__step--done"
          : n === currentStep ? " confirm-modal__step--active"
          : "";
        const sep = i < steps.length - 1
          ? `<span class="confirm-modal__step-sep" aria-hidden="true">›</span>`
          : "";
        return `<li class="confirm-modal__step${stateClass}">`
          + `<span class="confirm-modal__step-num">${n < currentStep ? "✓" : n}</span>`
          + `<span class="confirm-modal__step-label">${label}</span>`
          + `</li>${sep}`;
      }).join("")}</ol>`;
    }

    overlay.innerHTML = `
      <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div class="modal__header">
          <span class="modal__title" id="confirm-modal-title">${title}</span>
          <button class="modal__close" aria-label="Close" data-confirm-action="cancel">&times;</button>
        </div>
        ${stepsHtml}
        <div class="confirm-modal__body">${bodyHtml}</div>
        <div class="confirm-modal__actions">
          <button class="btn btn--outline" data-confirm-action="cancel">${cancelLabel}</button>
          <button class="btn btn--${confirmTone}" data-confirm-action="confirm">${confirmLabel}</button>
        </div>
      </div>
    `;

    const previouslyFocused = document.activeElement;
    function close(result) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try { previouslyFocused.focus(); } catch {}
      }
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      else if (e.key === "Enter") { e.preventDefault(); close(true); }
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { close(false); return; }
      const action = e.target.closest("[data-confirm-action]")?.dataset.confirmAction;
      if (action === "cancel") close(false);
      else if (action === "confirm") close(true);
    });

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-confirm-action="confirm"]')?.focus();
  });
}

// ── Loading State ────────────────────────────────────

export function showLoading(container) {
  container.style.cssText = "";
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
}

// ── Auth Gate ────────────────────────────────────────

/**
 * Show sign-in prompt in the main content area when user is not authenticated
 */
export function showAuthGate(container) {
  let isRegister = false;

  // Make the main container fill the viewport behind the card
  container.style.cssText = `
    position:relative;
    min-height:calc(100vh - 60px);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:2rem 1rem;
    background:url('img/loadpage.jpg') center 57%/cover no-repeat fixed;
    margin:0;
    max-width:100%;
  `;

  function render() {
    container.innerHTML = `
      <!-- Dark overlay for readability -->
      <div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.25) 50%,rgba(0,0,0,0.5) 100%);z-index:0"></div>

      <div class="auth-gate" style="
        position:relative;z-index:1;
        max-width:380px;width:100%;
        background:rgba(255,255,255,0.88);
        backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
        border-radius:16px;
        padding:2.5rem 2rem;
        box-shadow:0 8px 32px rgba(0,0,0,0.25);
        border:1px solid rgba(255,255,255,0.3);
      ">
        <div style="text-align:center;margin-bottom:1.5rem">
          <img src="img/Fsurf_logo_with_text.png" alt="Fantasy Surfer" style="height:36px;margin-bottom:1rem">
          <h2 style="margin:0 0 0.4rem;font-size:1.5rem;color:var(--color-charcoal)">Welcome to Fantasy Surfer</h2>
          <p style="margin:0;color:var(--color-warm-gray);font-size:0.9rem">Sign in to join the game, pick your team, and compete on the leaderboard.</p>
        </div>

        <button class="btn btn--primary btn--lg" id="btn-gate-signin" style="width:100%;font-size:0.95rem;padding:0.7rem">Sign In with Google</button>

        <div style="display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0">
          <hr style="flex:1;border:none;border-top:1px solid rgba(0,0,0,0.12)">
          <span style="font-size:0.8rem;color:var(--color-warm-gray)">or</span>
          <hr style="flex:1;border:none;border-top:1px solid rgba(0,0,0,0.12)">
        </div>

        <div style="display:flex;flex-direction:column;gap:0.6rem">
          ${isRegister ? `<input type="text" id="auth-name" placeholder="Your name" class="form-input" style="width:100%;padding:0.55rem 0.75rem;border:1px solid rgba(0,0,0,0.15);border-radius:8px;font-size:0.9rem;background:rgba(255,255,255,0.7)">` : ""}
          <input type="email" id="auth-email" placeholder="Email address" class="form-input" style="width:100%;padding:0.55rem 0.75rem;border:1px solid rgba(0,0,0,0.15);border-radius:8px;font-size:0.9rem;background:rgba(255,255,255,0.7)">
          <input type="password" id="auth-password" placeholder="Password" class="form-input" style="width:100%;padding:0.55rem 0.75rem;border:1px solid rgba(0,0,0,0.15);border-radius:8px;font-size:0.9rem;background:rgba(255,255,255,0.7)">
          <button class="btn btn--outline" id="btn-email-submit" style="width:100%">${isRegister ? "Create Account" : "Sign In"}</button>
          <p id="auth-error" style="color:#b45309;font-size:0.85rem;text-align:center;min-height:1.2rem"></p>
          <div style="display:flex;justify-content:space-between;font-size:0.85rem">
            <a href="#" id="auth-toggle" style="color:var(--color-sage)">${isRegister ? "Already have an account?" : "Create an account"}</a>
            ${!isRegister ? `<a href="#" id="auth-forgot" style="color:var(--color-sage)">Forgot password?</a>` : ""}
          </div>
        </div>
      </div>
    `;

    document.getElementById("btn-gate-signin")?.addEventListener("click", signIn);

    async function submitEmailForm() {
      const email = document.getElementById("auth-email")?.value.trim();
      const password = document.getElementById("auth-password")?.value;
      const name = document.getElementById("auth-name")?.value.trim();
      const errEl = document.getElementById("auth-error");
      errEl.textContent = "";
      try {
        if (isRegister) {
          await registerWithEmail(email, password, name);
        } else {
          await signInWithEmail(email, password);
        }
      } catch (err) {
        errEl.textContent = err.message;
      }
    }

    document.getElementById("btn-email-submit")?.addEventListener("click", submitEmailForm);

    // Submit on Enter key in any form input
    ["auth-name", "auth-email", "auth-password"].forEach((id) => {
      document.getElementById(id)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitEmailForm();
      });
    });

    document.getElementById("auth-toggle")?.addEventListener("click", (e) => {
      e.preventDefault();
      isRegister = !isRegister;
      render();
    });

    document.getElementById("auth-forgot")?.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email")?.value.trim();
      const errEl = document.getElementById("auth-error");
      if (!email) { errEl.textContent = "Enter your email address first."; return; }
      try {
        await resetPassword(email);
        errEl.style.color = "green";
        errEl.textContent = "Password reset email sent.";
      } catch (err) {
        errEl.style.color = "#b45309";
        errEl.textContent = err.message;
      }
    });
  }

  render();
}

// ── Generic Table Renderer ───────────────────────────

/**
 * Render a simple HTML table
 * @param {string[]} headers
 * @param {string[][]} rows - each row is an array of cell HTML
 * @returns {string} HTML string
 */
export function renderTable(headers, rows) {
  return `
    <table class="data-table">
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((row) =>
          `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`
        ).join("")}
      </tbody>
    </table>
  `;
}
