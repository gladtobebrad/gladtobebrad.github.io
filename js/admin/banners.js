// js/admin/banners.js — Site Banners card: live-status + countdown preview/toggles.
// No module-state coupling (reads via Firestore). The window._countdownPreviewInterval
// cleanup stays in the shell's renderAdmin; wireBanners only SETS it.
import { getSiteConfig, saveSiteConfig, getCurrentEventForTour } from "../db.js";
import { SEASON, tourLabel } from "../config.js";
import { resolveCountdownState, startCountdownTimer, fetchLiveStatusCached, renderLiveStatusBanner, toast } from "../ui.js";

// Apply a tri-state to a banner toggle: "available" (Shown/Hidden, clickable),
// "unavailable" (locked + greyed; preserves the user's saved preference for
// when content reappears), or "checking" (locked + greyed while a fetch is
// in flight). The saved checkbox value is preserved across states so the
// toggle restores correctly when content becomes eligible again.
function setBannerToggleState(toggleEl, { state, savedShown, reason }) {
  const checkbox = toggleEl.querySelector("input");
  const label = toggleEl.querySelector(".toggle__label");
  checkbox.checked = savedShown;
  if (state === "available") {
    checkbox.disabled = false;
    label.textContent = savedShown ? "Shown" : "Hidden";
    toggleEl.style.opacity = "";
    toggleEl.style.cursor = "";
    toggleEl.removeAttribute("title");
  } else {
    checkbox.disabled = true;
    label.textContent = state === "checking" ? "Checking…" : "Unavailable";
    toggleEl.style.opacity = "0.5";
    toggleEl.style.cursor = "not-allowed";
    if (reason) toggleEl.title = reason;
  }
}

export async function wireBanners() {
  const countdownPreview = document.getElementById("countdown-preview");
  const countdownToggle = document.getElementById("toggle-banner");
  const liveStatusPreview = document.getElementById("live-status-preview");
  const liveStatusToggle = document.getElementById("toggle-live-status");
  if (!countdownPreview || !countdownToggle || !liveStatusPreview || !liveStatusToggle) return;

  // Phase 1: load only the fast/local inputs (Firestore). Anything that
  // depends on WSL goes into Phase 2 below so a WSL outage cannot brick
  // the toggles or the countdown preview.
  let siteConfig = {};
  let mensEv = null, womensEv = null;
  try {
    [siteConfig, mensEv, womensEv] = await Promise.all([
      getSiteConfig(),
      getCurrentEventForTour("mens", SEASON),
      getCurrentEventForTour("womens", SEASON),
    ]);
  } catch (err) {
    countdownPreview.textContent = "Could not load banner state.";
    return;
  }

  // ── Live status row: preview placeholder + toggle in "Checking…" state ──
  // The toggle starts locked because we don't yet know if WSL has an
  // active event to display. Phase 2 below transitions it to either
  // "available" (when WSL returns content) or "unavailable".
  const liveSavedShown = siteConfig.showLiveStatus !== false;
  liveStatusPreview.style.color = "var(--color-warm-gray)";
  liveStatusPreview.removeAttribute("title");
  liveStatusPreview.textContent = "Checking WSL…";
  liveStatusPreview.style.display = "";
  setBannerToggleState(liveStatusToggle, { state: "checking", savedShown: liveSavedShown });

  const liveCheckbox = liveStatusToggle.querySelector("input");
  liveCheckbox.addEventListener("change", async () => {
    // Native disabled prevents firing in "checking"/"unavailable" states.
    const shown = liveCheckbox.checked;
    const liveLabel = liveStatusToggle.querySelector(".toggle__label");
    liveLabel.textContent = shown ? "Shown" : "Hidden";
    try {
      await saveSiteConfig({ showLiveStatus: shown });
      toast(`Live status banner ${shown ? "shown" : "hidden"}.`, "success");
    } catch (err) {
      toast("Error saving banner state: " + err.message, "error");
      liveCheckbox.checked = !shown;
      liveLabel.textContent = !shown ? "Shown" : "Hidden";
    }
  });

  // ── Countdown row: preview + toggle ──
  // Wired entirely from local data; never blocks on WSL.
  const cdSavedShown = siteConfig.showCountdown !== false;
  const state = resolveCountdownState({ mensEv, womensEv });
  if (!state) {
    countdownPreview.textContent = "Nothing — no tour has open trading with a start date.";
    countdownPreview.style.color = "var(--color-warm-gray)";
    countdownPreview.removeAttribute("title");
    setBannerToggleState(countdownToggle, {
      state: "unavailable",
      savedShown: cdSavedShown,
      reason: "No tour has open trading with a start date.",
    });
  } else {
    countdownPreview.style.color = "var(--text)";
    countdownPreview.title = `Source: ${state.event.name} (${tourLabel(state.tour)}) · deadline from ${state.deadlineSource}`;
    window._countdownPreviewInterval = startCountdownTimer(countdownPreview, state);
    setBannerToggleState(countdownToggle, { state: "available", savedShown: cdSavedShown });
  }

  const cdCheckbox = countdownToggle.querySelector("input");
  cdCheckbox.addEventListener("change", async () => {
    const shown = cdCheckbox.checked;
    const cdLabel = countdownToggle.querySelector(".toggle__label");
    cdLabel.textContent = shown ? "Shown" : "Hidden";
    try {
      await saveSiteConfig({ showCountdown: shown });
      toast(`Countdown banner ${shown ? "shown" : "hidden"}.`, "success");
    } catch (err) {
      toast("Error saving banner state: " + err.message, "error");
      cdCheckbox.checked = !shown;
      cdLabel.textContent = !shown ? "Shown" : "Hidden";
    }
  });

  // Phase 2: fetch live status in the background. Resolves the toggle's
  // state (available vs unavailable) once we know what WSL returned.
  fetchLiveStatusCached(SEASON).then((liveStatus) => {
    if (!document.body.contains(liveStatusPreview)) return;
    if (liveStatus) {
      liveStatusPreview.style.color = "var(--text)";
      liveStatusPreview.title = `Source: WSL /events/${SEASON}/ct (cached ~60s)`;
      renderLiveStatusBanner(liveStatusPreview, liveStatus);
      liveStatusPreview.style.display = "";
      setBannerToggleState(liveStatusToggle, { state: "available", savedShown: liveSavedShown });
    } else {
      liveStatusPreview.style.color = "var(--color-warm-gray)";
      liveStatusPreview.removeAttribute("title");
      liveStatusPreview.style.display = "";
      // Distinguish "WSL says no active event" from "WSL unreachable" by
      // peeking at the cache's fail-TTL stamp.
      let failed = false;
      try {
        const cached = JSON.parse(sessionStorage.getItem("wsl_live_status") || "null");
        failed = cached && cached.data === null && cached.ttl < 30_000;
      } catch {}
      liveStatusPreview.textContent = failed
        ? "WSL unreachable — banner will retry automatically."
        : "Nothing — WSL has no active event right now.";
      setBannerToggleState(liveStatusToggle, {
        state: "unavailable",
        savedShown: liveSavedShown,
        reason: failed
          ? "WSL is currently unreachable."
          : "WSL has no active event right now.",
      });
    }
  });
}
