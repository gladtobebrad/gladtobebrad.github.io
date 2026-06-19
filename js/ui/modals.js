// js/ui/modals.js — overlay / notification primitives: toast, confirm dialog, sign-in gate.
import { escapeHtml } from "./escape.js";
import { signIn, signInWithEmail, registerWithEmail, resetPassword } from "../auth.js";

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
 * Show a toast notification.
 * Dedupes by message+type: if an identical toast is currently visible, the
 * call is a no-op (does not stack, does not reset the timer).
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} duration - ms
 */
export function toast(message, type = "info", duration = 3500) {
  ensureToastContainer();
  // Dedupe: skip if an identical visible toast is already up.
  for (const existing of toastContainer.children) {
    if (
      existing.dataset.toastMessage === message
      && existing.classList.contains(`toast--${type}`)
      && existing.classList.contains("toast--visible")
    ) {
      return;
    }
  }
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  el.textContent = message;
  el.dataset.toastMessage = message;
  toastContainer.appendChild(el);
  // Trigger animation
  requestAnimationFrame(() => el.classList.add("toast--visible"));
  setTimeout(() => {
    el.classList.remove("toast--visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
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
  currentStep = 1,     // 1-based index into `steps`
  requireText = null   // if set, the user must type this exact text before Confirm enables
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

    const requireHtml = requireText
      ? `<div class="confirm-modal__require">
          <label class="form-label" for="confirm-require-input">Type <strong>${escapeHtml(requireText)}</strong> to confirm</label>
          <input type="text" class="search-input" id="confirm-require-input" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escapeHtml(requireText)}">
        </div>`
      : "";

    overlay.innerHTML = `
      <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div class="modal__header">
          <span class="modal__title" id="confirm-modal-title">${title}</span>
          <button class="modal__close" aria-label="Close" data-confirm-action="cancel">&times;</button>
        </div>
        ${stepsHtml}
        <div class="confirm-modal__body">${bodyHtml}</div>
        ${requireHtml}
        <div class="confirm-modal__actions">
          <button class="btn btn--outline" data-confirm-action="cancel">${cancelLabel}</button>
          <button class="btn btn--${confirmTone}" data-confirm-action="confirm"${requireText ? " disabled" : ""}>${confirmLabel}</button>
        </div>
      </div>
    `;

    const confirmBtn = overlay.querySelector('[data-confirm-action="confirm"]');
    const reqInput = overlay.querySelector("#confirm-require-input");
    const textMatches = () => !requireText || (reqInput?.value.trim() === requireText);

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
      else if (e.key === "Enter") { e.preventDefault(); if (textMatches()) close(true); }
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { close(false); return; }
      const action = e.target.closest("[data-confirm-action]")?.dataset.confirmAction;
      if (action === "cancel") close(false);
      else if (action === "confirm" && textMatches()) close(true);
    });

    if (reqInput) reqInput.addEventListener("input", () => { confirmBtn.disabled = !textMatches(); });

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    (reqInput || confirmBtn)?.focus();
  });
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
          <img src="img/Fsurf_logo_with_text.png" alt="Fantasy Surfer" class="theme-logo theme-logo--light" style="height:36px;margin-bottom:1rem">
          <img src="img/Fsurf_logo_with_text_white.png" alt="Fantasy Surfer" class="theme-logo theme-logo--dark" style="height:36px;margin-bottom:1rem">
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
          <p id="auth-error" style="color:var(--color-error);font-size:0.85rem;text-align:center;min-height:1.2rem"></p>
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
        errEl.style.color = "var(--color-error)";
        errEl.textContent = err.message;
      }
    });
  }

  render();
}
