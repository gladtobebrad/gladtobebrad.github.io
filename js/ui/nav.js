// js/ui/nav.js — page chrome: header/nav (+ banner orchestration), footer, bootstrapPage,
// and the profile-edit modal opened from the nav menu.
import { escapeHtml, safeUrl } from "./escape.js";
import { resolveCountdownState, fetchLiveStatusCached, renderLiveStatusBanner, startCountdownTimer } from "./banners.js";
import { toast, showAuthGate } from "./modals.js";
import { showLoading } from "./format.js";
import { initAuth, signIn, signOut, onAuth, requireAuth, requireAdmin, currentProfile } from "../auth.js";
import { SEASON } from "../config.js";
import { getStoredTheme, setTheme, reconcileTheme } from "../theme.js";

// ── Navigation ───────────────────────────────────────

const NAV_ITEMS = [
  { title: "My Team", href: "team.html" },
  { title: "Standings", href: "standings.html" },
  { title: "Clubhouse", href: "club.html" },
  { title: "Data Vault", href: "surfers.html" },
  { title: "About", href: "about.html" },
];

/**
 * Render the public live-status + countdown banners into their slots.
 * Derived purely from event/config data, so it runs regardless of sign-in
 * state. Each Firestore read is guarded so one failed read can't blank both
 * banners. Live banner takes priority — if WSL reports an active event and the
 * admin hasn't hidden it, show it and suppress the countdown; otherwise fall
 * back to the countdown when eligible.
 */
async function renderBanners(liveStatusEl, countdownEl) {
  try {
    const { getCurrentEventForTour, getSiteConfig } = await import("../db.js");
    const [mensEv, womensEv, siteConfig, liveStatus] = await Promise.all([
      getCurrentEventForTour("mens", SEASON).catch(() => null),
      getCurrentEventForTour("womens", SEASON).catch(() => null),
      getSiteConfig().catch(() => ({})),
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
  } catch (e) {
    console.warn("Banner render failed:", e);
  }
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
        <img src="img/Fsurf_logo_with_text.png" alt="Fantasy Surfer" class="theme-logo theme-logo--light" style="height:26px">
        <img src="img/Fsurf_logo_with_text_white.png" alt="Fantasy Surfer" class="theme-logo theme-logo--dark" style="height:26px">
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
    liveStatusEl.style.cssText = "display:none;text-align:center;padding:0.4rem 1rem;background:var(--banner-live-bg);font-size:0.85rem;color:var(--banner-live-text)";
    header.parentNode.insertBefore(liveStatusEl, header.nextSibling);
  }
  let countdownEl = document.getElementById("trading-countdown");
  if (!countdownEl) {
    countdownEl = document.createElement("div");
    countdownEl.id = "trading-countdown";
    countdownEl.style.cssText = "display:none;text-align:center;padding:0.4rem 1rem;background:var(--color-error-bg);font-size:0.85rem;color:var(--text)";
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
    // Adopt the account's saved theme on login (only if this device has no
    // explicit local choice — localStorage always wins first paint).
    reconcileTheme(profile?.theme);
    const authEl = document.getElementById("nav-auth");
    if (!authEl) return;
    if (user) {
      const brandLink = document.getElementById("nav-brand-link");
      if (brandLink) brandLink.href = "index.html";
      const photoSrc = safeUrl(profile?.avatarUrl || user.photoURL);
      const photo = photoSrc
        ? `<img src="${escapeHtml(photoSrc)}" alt="" class="nav-avatar" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
        : `<div class="nav-avatar" style="background:var(--color-sage);color:var(--on-accent);display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:0.85rem">${escapeHtml((profile?.displayName || user.displayName || "?")[0])}</div>`;
      const adminLink = profile?.isAdmin
        ? `<a href="admin.html" class="nav-admin-link">Admin</a>`
        : "";
      authEl.innerHTML = `
        ${adminLink}
        <div class="nav-user-menu">
          <button class="nav-user-btn" id="nav-user-btn" aria-haspopup="true" aria-expanded="false">
            ${photo}
            <span class="nav-user-name">${escapeHtml(user.displayName || "User")}</span>
            <span class="nav-user-caret" aria-hidden="true">▾</span>
          </button>
          <div class="nav-user-dropdown" id="nav-user-dropdown" role="menu">
            <button data-action="profile" role="menuitem">Profile</button>
            <button data-action="signout" role="menuitem">Sign Out</button>
          </div>
        </div>
      `;
      const userBtn = document.getElementById("nav-user-btn");
      const dropdown = document.getElementById("nav-user-dropdown");
      userBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.toggle("open");
        userBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
      document.addEventListener("click", (e) => {
        if (dropdown && !dropdown.contains(e.target) && !userBtn.contains(e.target)) {
          dropdown.classList.remove("open");
          userBtn.setAttribute("aria-expanded", "false");
        }
      });
      dropdown?.querySelector('[data-action="profile"]')?.addEventListener("click", () => {
        dropdown.classList.remove("open");
        userBtn.setAttribute("aria-expanded", "false");
        openProfileEditModal(user, profile);
      });
      dropdown?.querySelector('[data-action="signout"]')?.addEventListener("click", signOut);

      // Render the live-status + countdown banners once auth resolves. Kept
      // inside the signed-in branch: the rest of the app is auth-gated, so a
      // logged-out visitor's Firestore reads (events/config) are denied and the
      // banner can't resolve its data anyway.
      renderBanners(liveStatusEl, countdownEl);
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

/**
 * The universal page preamble + (optional) auth dispatch. Initialises auth,
 * renders the shared header/footer, and returns the #app-main element.
 *
 * Called with NO argument it is the original minimal preamble — the page owns its
 * own auth dispatch (onAuth / requireAuth / requireAdmin) with `main` in scope.
 *
 * Called with a config it ALSO owns the gate:
 *   bootstrapPage({ auth, render, onUnauth, onGate })
 *     auth:     "static" | "user" (default) | "admin"
 *     render:   ({ main, user, profile }) => void|Promise   (static gets just { main })
 *     onUnauth: "gate" (default — showAuthGate in place) | "redirect" (→ index.html)
 *     onGate:   optional () => void, fired when the gate is shown on sign-out
 *
 * "user" semantics: render on a sign-in transition, re-gate/redirect on sign-out,
 * and IGNORE no-op same-user refires (e.g. the ~hourly token refresh) so a page's
 * own in-render re-render loop is never double-fired. "admin" delegates to
 * requireAdmin (fresh isAdmin re-fetch + redirect-on-fail) and renders once.
 *
 * @returns {HTMLElement} the #app-main content container
 */
export function bootstrapPage(config) {
  initAuth();
  renderHeader();
  renderFooter();
  const main = document.getElementById("app-main");
  if (!config) return main; // legacy: page owns its own auth dispatch

  const { auth = "user", render, onUnauth = "gate", onGate } = config;

  // Static: no gating — render once, independent of auth state.
  if (auth === "static") {
    render?.({ main });
    return main;
  }

  // Admin: requireAdmin owns the redirect-on-fail + fresh isAdmin re-fetch; once.
  if (auth === "admin") {
    requireAdmin().then((user) => {
      showLoading(main);
      render?.({ main, user, profile: currentProfile() });
    });
    return main;
  }

  // User + redirect: requireAuth owns the redirect-to-index for signed-out; once.
  if (onUnauth === "redirect") {
    requireAuth().then((user) => {
      showLoading(main);
      render?.({ main, user, profile: currentProfile() });
    });
    return main;
  }

  // User + inline gate: show the sign-in card when signed out; render on a
  // sign-in transition only (skip no-op same-user refires so the page's own
  // re-render loop isn't double-fired). onGate fires on each sign-out.
  let renderedUid = null;
  onAuth(async (user, profile) => {
    if (!user) {
      renderedUid = null;
      onGate?.();
      showAuthGate(main);
      return;
    }
    if (user.uid === renderedUid) return;
    renderedUid = user.uid;
    showLoading(main);
    await render?.({ main, user, profile });
  });
  return main;
}

// ── Profile Edit Modal ───────────────────────────────

/**
 * Prepare an avatar file for upload. Decodes the image FIRST — which also
 * proves it can be displayed — then downscales + JPEG-re-encodes it. Avatars
 * never render larger than ~72px, so a 320px cap is visually lossless yet turns
 * a multi-MB phone photo into a ~20–40 KB file (~50–100× smaller) — the same
 * PNG→JPG win as the landing page.
 *
 * Returns:
 *   • a JPEG Blob — the normal compressed result;
 *   • the original `file` — when it's already small, or re-encoding wouldn't
 *     save bytes (both are valid, displayable images);
 *   • null — when the file can't be decoded (e.g. a HEIC mislabelled `.jpg`).
 *     It wouldn't render in an <img> anyway, so the caller rejects it rather
 *     than store a large, undisplayable blob.
 * The caller checks `=== file` to pick the contentType and `== null` to reject.
 */
async function compressAvatar(file, { maxSize = 320, quality = 0.82 } = {}) {
  let img;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = dataUrl;
    });
  } catch {
    return null; // undecodable -> won't display anywhere -> caller rejects
  }
  if (file.size <= 64 * 1024) return file; // small + decodable -> skip lossy round-trip
  try {
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height)); // never upscale
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // flatten transparency — JPEG has no alpha channel
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // decoded fine; encode hiccup -> original is still displayable
  }
}

/**
 * Open a modal dialog to edit the current user's profile (team name + avatar).
 * Called from the nav-user dropdown ("Profile" item). Reloads page on save.
 */
export function openProfileEditModal(user, profile) {
  const avatarUrl = profile?.avatarUrl || profile?.photoUrl || user.photoURL || "";
  const initial = escapeHtml((profile?.displayName || user.displayName || "?")[0]);
  const safeAvatar = safeUrl(avatarUrl);
  const avatarPreview = safeAvatar
    ? `<img src="${escapeHtml(safeAvatar)}" alt="" class="avatar-preview" id="pe-avatar-preview" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="avatar-preview avatar-preview--empty" id="pe-avatar-preview">${initial}</div>`;
  const urlValue = (profile?.avatarUrl && !profile.avatarUrl.startsWith("https://firebasestorage")) ? profile.avatarUrl : "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pe-title">
      <div class="modal__header">
        <span class="modal__title" id="pe-title">Edit Profile</span>
        <button class="modal__close" aria-label="Close" data-action="close">&times;</button>
      </div>
      <div class="profile-edit">
        <div class="profile-edit__avatar">${avatarPreview}</div>
        <div class="profile-edit__fields">
          <div class="form-group mb-1">
            <label class="form-label">Team Name</label>
            <input type="text" class="search-input" id="pe-team-name" maxlength="30" value="${escapeHtml(profile?.teamName || "")}">
          </div>
          <div class="form-group mb-1">
            <label class="form-label">Profile Photo</label>
            <div id="pe-drop-zone" style="border:2px dashed var(--border);border-radius:8px;padding:0.6rem 0.8rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;cursor:pointer;transition:border-color 0.15s,background 0.15s">
              <label class="btn btn--outline btn--sm" style="cursor:pointer;margin:0">
                Choose File
                <input type="file" id="pe-file" accept="image/jpeg,image/png" style="display:none">
              </label>
              <span class="text-xs text-muted" id="pe-file-name">JPG or PNG — or drag &amp; drop</span>
            </div>
            <p class="text-xs text-muted mt-1">or paste a URL: <input type="text" class="search-input" id="pe-url" placeholder="https://i.imgur.com/..." value="${escapeHtml(urlValue)}" style="display:inline;width:auto;max-width:200px;padding:0.2rem 0.4rem;font-size:0.8rem"></p>
          </div>
          <div class="form-group mb-1">
            <label class="form-label">Appearance</label>
            <div class="theme-seg" role="radiogroup" aria-label="Theme">
              <button type="button" class="theme-seg__opt" data-theme-pref="light" role="radio">Light</button>
              <button type="button" class="theme-seg__opt" data-theme-pref="dark" role="radio">Dark</button>
              <button type="button" class="theme-seg__opt" data-theme-pref="system" role="radio">System</button>
            </div>
          </div>
        </div>
      </div>
      <div class="confirm-modal__actions" style="margin-top:1rem">
        <button class="btn btn--outline" data-action="close">Cancel</button>
        <button class="btn btn--primary" id="pe-save">Save Profile</button>
      </div>
    </div>
  `;

  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) return close();
    if (e.target.closest('[data-action="close"]')) return close();
  });
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);

  // ── Theme (Light / Dark / System) — applies instantly; persisted on Save ──
  const themeSeg = overlay.querySelector(".theme-seg");
  if (themeSeg) {
    const markTheme = () => {
      const cur = getStoredTheme();
      themeSeg.querySelectorAll(".theme-seg__opt").forEach((btn) =>
        btn.classList.toggle("is-active", btn.dataset.themePref === cur));
    };
    markTheme();
    themeSeg.querySelectorAll(".theme-seg__opt").forEach((btn) =>
      btn.addEventListener("click", () => { setTheme(btn.dataset.themePref); markTheme(); }));
  }

  // ── File / URL / drag-drop handlers ──
  const fileInput = document.getElementById("pe-file");
  const fileNameEl = document.getElementById("pe-file-name");
  const FILE_HINT = "JPG or PNG — or drag & drop";
  // Only JPG/PNG: anything else (HEIC, GIF, WEBP…) either won't display in an
  // <img> on every browser or can't be decoded for compression, so we reject it
  // up front rather than store a large, undisplayable blob.
  const applyFile = (file) => {
    if (!file) return;
    const allowed = ["image/jpeg", "image/png"].includes(file.type) || /\.(jpe?g|png)$/i.test(file.name);
    if (!allowed) {
      toast("Please choose a JPG or PNG image.", "error");
      if (fileInput) fileInput.value = "";       // drop the rejected native selection
      if (fileNameEl) fileNameEl.textContent = FILE_HINT;
      return;
    }
    fileNameEl.textContent = file.name;
    document.getElementById("pe-url").value = "";
    const preview = document.getElementById("pe-avatar-preview");
    if (preview && preview.tagName === "IMG") preview.src = URL.createObjectURL(file);
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  };
  document.getElementById("pe-file")?.addEventListener("change", (e) => applyFile(e.target.files[0]));

  const dropZone = document.getElementById("pe-drop-zone");
  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.style.borderColor = "var(--color-sage)"; dropZone.style.background = "rgba(0,0,0,0.03)"; });
    dropZone.addEventListener("dragleave", () => { dropZone.style.borderColor = ""; dropZone.style.background = ""; });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "";
      dropZone.style.background = "";
      applyFile(e.dataTransfer.files[0]);
    });
  }

  // ── Save ──
  document.getElementById("pe-save")?.addEventListener("click", async () => {
    const name = document.getElementById("pe-team-name")?.value.trim();
    if (!name) { toast("Team name is required.", "error"); return; }

    const file = document.getElementById("pe-file")?.files[0];
    const urlInput = document.getElementById("pe-url")?.value.trim();
    if (urlInput && safeUrl(urlInput) === "") {
      toast("Photo URL must be an http(s) link.", "error");
      return;
    }
    let finalUrl = urlInput || profile?.avatarUrl || "";

    if (file) {
      try {
        const upload = await compressAvatar(file);
        if (!upload) {
          toast("That image couldn't be read — please use a standard JPG or PNG.", "error");
          return;
        }
        toast("Uploading photo…", "info");
        const { storage } = await import("../firebase-config.js");
        const { ref, uploadBytes, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js");
        // Compressed result is a JPEG blob; the original-file fallback keeps its
        // own type — let uploadBytes infer it.
        const metadata = upload === file ? undefined : { contentType: "image/jpeg" };
        const storageRef = ref(storage, `avatars/${user.uid}`);
        await uploadBytes(storageRef, upload, metadata);
        finalUrl = await getDownloadURL(storageRef);
      } catch (err) {
        toast("Upload failed: " + err.message, "error");
        return;
      }
    }

    try {
      const { updateUser } = await import("../db.js");
      await updateUser(user.uid, { teamName: name, avatarUrl: finalUrl, theme: getStoredTheme() });
      toast("Profile saved!", "success");
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast("Save failed: " + err.message, "error");
    }
  });
}
