// js/admin/results.js — Results tab: manual results-entry grid + clear-all-results.
import { getResults, saveResultsBatch, clearResults, saveEvent, touchEventsVersion } from "../db.js";
import { getPoints, getMaxFinishPosition } from "../scoring.js";
import { SEASON } from "../config.js";
import { confirmModal, toast, escapeHtml } from "../ui.js";
import { promptUpdateLeaderboard } from "./leaderboard.js";

export function wireResults(ctx) {
      document.getElementById("results-event-select")?.addEventListener("change", async (e) => {
        const eventId = e.target.value;
        const rc = document.getElementById("results-form-container");
        if (!eventId) { rc.innerHTML = ""; return; }

        rc.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
        const ev = ctx.events.find((x) => x.id === eventId);

        // Load existing results
        const existing = await getResults(eventId);
        const existingMap = {};
        existing.forEach((r) => { existingMap[r.surferId] = r; });

        const eventTour = ev?.tour || "mens";
        const eventSurfers = ctx.surfers
          .filter((s) => (s.tour || "mens") === eventTour && (s.status || (s.active === false ? "inactive" : "active")) !== "inactive")
          .sort((a, b) => (a.rank || 99) - (b.rank || 99));
        const maxPos = getMaxFinishPosition(eventTour);

        rc.innerHTML = `
          <form id="results-entry-form">
            <p class="text-sm text-muted mb-2">Enter finish position (1–${maxPos}) or WDRW for withdrawn surfers. Leave blank if no result yet.</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.4rem;margin-bottom:1rem">
              ${eventSurfers.map((s) => {
                const ex = existingMap[s.id];
                return `<div style="display:flex;align-items:center;gap:0.4rem;padding:0.35rem 0.5rem;border:1px solid var(--color-beige);border-radius:6px;background:var(--surface)">
                  <span style="font-size:0.72rem;color:var(--color-warm-gray);flex-shrink:0;min-width:1.6rem">#${s.rank || "?"}</span>
                  <span style="flex:1;font-size:0.82rem;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
                  <input class="form-input" type="text" data-result-surfer="${s.id}" data-result-tour="${eventTour}" value="${ex?.withdrawn ? "WDRW" : (ex?.finish || "")}" style="width:55px;padding:0.2rem 0.3rem;font-size:0.82rem;text-align:center" placeholder="">
                  <span class="result-pts" data-pts-for="${s.id}" style="font-size:0.72rem;color:var(--color-warm-gray);min-width:2rem;text-align:right">${ex?.withdrawn ? "WDRW" : (ex?.finish ? getPoints(ex.finish, eventTour) : "—")}</span>
                </div>`;
              }).join("")}
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Save All Results</button>
            </div>
          </form>
        `;

        // Auto-calculate points on input
        rc.querySelectorAll("[data-result-surfer]").forEach((inp) => {
          inp.addEventListener("input", () => {
            const val = inp.value.trim().toUpperCase();
            const t = inp.dataset.resultTour || "mens";
            const ptsCell = rc.querySelector(`[data-pts-for="${inp.dataset.resultSurfer}"]`);
            if (val === "WDRW") {
              ptsCell.textContent = "WDRW";
            } else {
              const pos = parseInt(val, 10);
              ptsCell.textContent = pos ? getPoints(pos, t) : "—";
            }
          });
        });

        // Save results
        document.getElementById("results-entry-form")?.addEventListener("submit", async (ev2) => {
          ev2.preventDefault();
          const resultsArr = [];
          rc.querySelectorAll("[data-result-surfer]").forEach((inp) => {
            const val = inp.value.trim().toUpperCase();
            if (!val) return;
            const t = inp.dataset.resultTour || "mens";
            if (val === "WDRW") {
              resultsArr.push({
                surferId: inp.dataset.resultSurfer,
                finish: null,
                points: 0,
                withdrawn: true,
                season: SEASON,
                tour: t
              });
            } else {
              const pos = parseInt(val, 10);
              if (!pos) return;
              resultsArr.push({
                surferId: inp.dataset.resultSurfer,
                finish: pos,
                points: getPoints(pos, t),
                withdrawn: false,
                season: SEASON,
                tour: t
              });
            }
          });
          if (resultsArr.length === 0) {
            toast("No results to save.", "error");
            return;
          }
          try {
            await saveResultsBatch(eventId, resultsArr);
            // Manual entry has no round-completion info — leave any existing
            // roundsCompleted/totalRounds (from a prior WSL scrape on this
            // event) untouched. Just stamp the source.
            await saveEvent(eventId, { resultsEntered: true, resultsSource: "manual" });
            try { await touchEventsVersion(); } catch {}
            await ctx.reload("events");
            toast(`Saved ${resultsArr.length} results!`, "success");
            // Offer the leaderboard recalc now that fresh results landed.
            await promptUpdateLeaderboard(ctx);
          } catch (err) {
            toast("Error: " + err.message, "error");
          }
        });
      });

      // ── CALCULATE SCORES ──
      document.getElementById("btn-clear-results")?.addEventListener("click", async () => {
        const eventId = document.getElementById("clear-results-event-select").value;
        if (!eventId) { toast("Select an event first.", "error"); return; }
        const ev = ctx.events.find((e) => e.id === eventId);
        if (!(await confirmModal({
          title: "Clear all results?",
          bodyHtml: `<p>This clears <strong>ALL results</strong> for ${escapeHtml(ev?.name || eventId)} and unsets resultsEntered. This cannot be undone.</p>`,
          confirmLabel: "Clear results",
          confirmTone: "danger",
        }))) return;
        try {
          await clearResults(eventId);
          await saveEvent(eventId, { resultsEntered: false });
          toast(`Results cleared for ${ev?.name || eventId}`, "success");
          location.reload();
        } catch (err) {
          toast("Error clearing results: " + err.message, "error");
        }
      });
}
