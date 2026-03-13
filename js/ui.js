import { getCurrentUser, getUserProfile, signIn, signOut, onAuth } from "./auth.js";

// ── Navigation ───────────────────────────────────────

const NAV_ITEMS = [
  { title: "Dashboard", href: "index.html" },
  { title: "My Team", href: "team.html" },
  { title: "Players", href: "players.html" },
  { title: "Club", href: "club.html" },
  { title: "Back to Site", href: "/" }
];

/**
 * Render the shared header/nav into an element with id="app-header"
 */
export function renderHeader() {
  const header = document.getElementById("app-header");
  if (!header) return;

  header.innerHTML = `
    <div class="nav-inner">
      <a href="index.html" class="nav-brand">Fantasy Surf League</a>
      <button class="nav-toggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-links" id="nav-links">
        ${NAV_ITEMS.map((item) =>
          `<li><a href="${item.href}">${item.title}</a></li>`
        ).join("")}
      </ul>
      <div class="nav-auth" id="nav-auth"></div>
    </div>
  `;

  // Hamburger toggle
  const toggle = header.querySelector(".nav-toggle");
  const links = header.querySelector(".nav-links");
  toggle?.addEventListener("click", () => {
    links.classList.toggle("open");
  });

  // Auth state UI
  onAuth((user, profile) => {
    const authEl = document.getElementById("nav-auth");
    if (!authEl) return;
    if (user) {
      const photo = user.photoURL
        ? `<img src="${user.photoURL}" alt="" class="nav-avatar">`
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
    } else {
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
      <p>Fantasy Surf League &mdash; Chapman Research Group</p>
      <p class="footer-sub">A friendly WSL fantasy game. Not affiliated with the World Surf League.</p>
    </div>
  `;
}

// ── Formatting Helpers ───────────────────────────────

/** Format a number as currency: $1,500,000 → "$1.5M" */
export function formatSalary(value) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
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

// ── Loading State ────────────────────────────────────

export function showLoading(container) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
}

// ── Auth Gate ────────────────────────────────────────

/**
 * Show sign-in prompt in the main content area when user is not authenticated
 */
export function showAuthGate(container) {
  container.innerHTML = `
    <div class="auth-gate">
      <h2>Welcome to Fantasy Surf League</h2>
      <p>Sign in with your Google account to join the game, pick your team, and compete on the leaderboard.</p>
      <button class="btn btn--primary btn--lg" id="btn-gate-signin">Sign In with Google</button>
    </div>
  `;
  document.getElementById("btn-gate-signin")?.addEventListener("click", signIn);
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
