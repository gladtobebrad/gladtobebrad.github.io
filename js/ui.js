import { getCurrentUser, getUserProfile, signIn, signOut, onAuth, signInWithEmail, registerWithEmail, resetPassword } from "./auth.js";

// ── Navigation ───────────────────────────────────────

const NAV_ITEMS = [
  { title: "Dashboard", href: "index.html" },
  { title: "My Profile", href: "profile.html", id: "nav-my-profile" },
  { title: "My Team", href: "team.html" },
  { title: "Club", href: "club.html" }, 
  { title: "Data", href: "data.html" },
  { title: "Surfers", href: "surfers.html" },
  { title: "Players", href: "players.html" },
  { title: "About", href: "about.html" },
];

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
      const profileLink = document.getElementById("nav-my-profile");
      if (profileLink) profileLink.href = `profile.html?id=${user.uid}`;
      const brandLink = document.getElementById("nav-brand-link");
      if (brandLink) brandLink.href = `profile.html?id=${user.uid}`;
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

// ── Loading State ────────────────────────────────────

export function showLoading(container) {
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
}

// ── Auth Gate ────────────────────────────────────────

/**
 * Show sign-in prompt in the main content area when user is not authenticated
 */
export function showAuthGate(container) {
  let isRegister = false;

  function render() {
    container.innerHTML = `
      <div class="auth-gate" style="max-width:360px;margin:0 auto">
        <h2>Welcome to Fantasy Surfer</h2>
        <p style="margin-bottom:1.5rem">Sign in to join the game, pick your team, and compete on the leaderboard.</p>

        <button class="btn btn--primary btn--lg" id="btn-gate-signin" style="width:100%">Sign In with Google</button>

        <div style="display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0">
          <hr style="flex:1;border:none;border-top:1px solid var(--color-beige)">
          <span style="font-size:0.8rem;color:var(--color-sage)">or</span>
          <hr style="flex:1;border:none;border-top:1px solid var(--color-beige)">
        </div>

        <div style="display:flex;flex-direction:column;gap:0.6rem">
          ${isRegister ? `<input type="text" id="auth-name" placeholder="Your name" class="form-input" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--color-beige);border-radius:6px;font-size:0.9rem">` : ""}
          <input type="email" id="auth-email" placeholder="Email address" class="form-input" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--color-beige);border-radius:6px;font-size:0.9rem">
          <input type="password" id="auth-password" placeholder="Password" class="form-input" style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--color-beige);border-radius:6px;font-size:0.9rem">
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

    document.getElementById("btn-email-submit")?.addEventListener("click", async () => {
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
