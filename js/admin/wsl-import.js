// js/admin/wsl-import.js — WSL fetch/scrape pipeline + Save-to-Firestore path.
import { fetchSchedule, pickTargetVenue, discoverGenders, scrapeEventForGender } from "../wsl-scrape.js";
import { buildSurferIndex, resolveSurfer, computeFinishPositions } from "../wsl-resolve.js";
import { getPoints } from "../scoring.js";
import { getResults, saveResultsBatch, saveEvent, touchEventsVersion } from "../db.js";
import { SEASON, TOURS, tourLabel } from "../config.js";
import { confirmModal, toast, escapeHtml } from "../ui.js";
import { promptUpdateLeaderboard } from "./leaderboard.js";

export function wireWslImport(ctx) {
      const wslFetchBtn = document.getElementById("btn-fetch-results");
      const wslFetchLog = document.getElementById("wsl-fetch-log");
      const wslFetchOut = document.getElementById("wsl-fetch-output");
      const scrapedByTour = {}; // populated on successful scrape, consumed by Save

      function wslLog(msg, level = "info") {
        if (!wslFetchLog) return;
        wslFetchLog.style.display = "block";
        const prefix = level === "error" ? "✗ " : level === "warn" ? "! " : "  ";
        const time = new Date().toLocaleTimeString();
        wslFetchLog.textContent += `[${time}] ${prefix}${msg}\n`;
        wslFetchLog.scrollTop = wslFetchLog.scrollHeight;
      }

      // Match a WSL venue+tour to a local event in our DB. Tries exact
      // normalized-name match first, then substring either direction so that
      // e.g. WSL's "New Zealand Pro" matches our "Corona Cero New Zealand Pro".
      function matchLocalEvent(wslEvent, localEvents) {
        const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const w = norm(wslEvent.name);
        let m = localEvents.find((e) => (e.tour || "mens") === wslEvent.tour && norm(e.name) === w);
        if (m) return m;
        m = localEvents.find((e) => (e.tour || "mens") === wslEvent.tour && (norm(e.name).includes(w) || w.includes(norm(e.name))));
        return m || null;
      }

      function renderScrapeSummary(byTour, warnings) {
        const sections = TOURS.map((tour) => {
          const g = byTour[tour];
          const label = tourLabel(tour);
          if (!g) {
            return `<div style="flex:1;min-width:260px"><h4 style="margin:0 0 0.4rem">${label}</h4><p class="text-muted text-sm">No data scraped.</p></div>`;
          }
          const rows = g.resolvedResults.map((r) =>
            `<tr><td style="padding:0.2rem 0.4rem;text-align:right;font-variant-numeric:tabular-nums">${r.finish}</td><td style="padding:0.2rem 0.4rem">${escapeHtml(r.surferName)}</td><td style="padding:0.2rem 0.4rem;text-align:right;font-variant-numeric:tabular-nums">${r.heatTotal != null ? r.heatTotal.toFixed(2) : "—"}</td><td style="padding:0.2rem 0.4rem;text-align:right;font-variant-numeric:tabular-nums">${r.points}</td></tr>`,
          ).join("");
          return `
            <div style="flex:1;min-width:260px">
              <h4 style="margin:0 0 0.2rem">${label} — ${escapeHtml(g.localEvent.name)}</h4>
              <p class="text-sm text-muted" style="margin:0 0 0.4rem">${g.resolvedResults.length} placements${g.unmatched.length ? ` · ${g.unmatched.length} unmatched` : ""}</p>
              <div style="max-height:280px;overflow-y:auto;border:1px solid var(--color-beige);border-radius:6px;background:#fff">
                <table style="width:100%;font-size:0.8rem;border-collapse:collapse">
                  <thead><tr style="background:var(--color-cream);position:sticky;top:0"><th style="padding:0.3rem 0.4rem;text-align:right">#</th><th style="padding:0.3rem 0.4rem;text-align:left">Surfer</th><th style="padding:0.3rem 0.4rem;text-align:right">Heat</th><th style="padding:0.3rem 0.4rem;text-align:right">Pts</th></tr></thead>
                  <tbody>${rows || `<tr><td colspan="4" style="padding:0.5rem;text-align:center;color:var(--color-warm-gray)">No completed rounds yet.</td></tr>`}</tbody>
                </table>
              </div>
            </div>
          `;
        }).join("");

        const warnHtml = warnings.length ? `
          <div class="mt-3" style="background:var(--color-warning-bg);border:1px solid var(--color-warning-border);border-radius:6px;padding:0.6rem 0.8rem">
            <strong style="color:var(--color-warning)">Warnings (${warnings.length}):</strong>
            <ul style="margin:0.3rem 0 0;padding-left:1.2rem;font-size:0.8rem;line-height:1.4">
              ${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}
            </ul>
          </div>` : "";

        const hasAny = Object.values(byTour).some((g) => g?.resolvedResults?.length);
        const saveBtnHtml = hasAny ? `
          <div class="form-actions mt-3">
            <button class="btn btn--primary" id="btn-save-scraped">Save Scraped Results to Firestore</button>
          </div>` : "";

        return `<div style="display:flex;gap:1rem;flex-wrap:wrap">${sections}</div>${warnHtml}${saveBtnHtml}`;
      }

      wslFetchBtn?.addEventListener("click", async () => {
        wslFetchLog.textContent = "";
        wslFetchLog.style.display = "none";
        wslFetchOut.innerHTML = "";
        wslFetchBtn.disabled = true;
        wslFetchBtn.textContent = "Fetching…";
        for (const k of Object.keys(scrapedByTour)) delete scrapedByTour[k];

        const allWarnings = [];

        try {
          const schedule = await fetchSchedule(SEASON, wslLog);
          const venue = pickTargetVenue(schedule);
          if (!venue) {
            wslLog("No active or recently-completed event found on the WSL schedule.", "error");
            allWarnings.push("WSL schedule had no active or completed events.");
            return;
          }
          wslLog(`Target venue: "${venue.name}" — status: ${venue.status}, WSL event #${venue.eventNumber}`);

          const genders = await discoverGenders(venue, SEASON, wslLog);

          for (const tour of TOURS) {
            const g = genders[tour];
            if (!g) {
              wslLog(`No ${tour} statEventId discovered for this venue.`, "warn");
              allWarnings.push(`No ${tour} draw discovered for "${venue.name}".`);
              continue;
            }
            // Build the gender-tagged event used by scrapeEventForGender and
            // for local-event matching.
            const wslEvent = {
              wslEventId: venue.wslEventId,
              slug: venue.slug,
              name: venue.name,
              eventNumber: venue.eventNumber,
              tour,
              statEventId: g.statEventId,
              status: g.status,
            };
            wslLog(`Processing ${tour}: statEventId=${g.statEventId} (${g.status})`);

            const localEvent = matchLocalEvent(wslEvent, ctx.events);
            if (!localEvent) {
              wslLog(`Could not match WSL ${tour} "${wslEvent.name}" to any local event.`, "error");
              allWarnings.push(`No local event matches WSL ${tour} event "${wslEvent.name}". Add a local ${tour} event with that name and re-run.`);
              continue;
            }
            wslLog(`  Local event: "${localEvent.name}" (id=${localEvent.id})`);

            let heats, totalRounds;
            try {
              ({ heats, totalRounds } = await scrapeEventForGender(wslEvent, SEASON, wslLog));
            } catch (err) {
              wslLog(`Scrape failed for ${tour}: ${err.message}`, "error");
              allWarnings.push(`${tour} scrape failed: ${err.message}`);
              continue;
            }

            const { places, warnings: placeWarnings } = computeFinishPositions(heats, totalRounds);
            allWarnings.push(...placeWarnings);

            // Build wslId → displayName lookup for the resolver.
            const nameByWslId = new Map();
            for (const h of heats) {
              for (const a of h.athletes) {
                if (a.displayName && !nameByWslId.has(a.wslId)) nameByWslId.set(a.wslId, a.displayName);
              }
            }

            const index = buildSurferIndex(ctx.surfers, tour);
            const resolvedResults = [];
            const unmatched = [];
            for (const [wslId, place] of places) {
              const displayName = nameByWslId.get(wslId) || "";
              const r = resolveSurfer(displayName, index);
              if (!r) {
                unmatched.push({ wslId, displayName, finish: place.finish });
                continue;
              }
              if (r.ambiguous) {
                allWarnings.push(`Ambiguous match for "${displayName}" — chose ${r.surfer.name}. Verify (multiple surfers share that first-initial + last name).`);
              }
              resolvedResults.push({
                surferId: r.surfer.id,
                surferName: r.surfer.name,
                finish: place.finish,
                points: place.withdrawn ? 0 : getPoints(place.finish, tour),
                withdrawn: !!place.withdrawn,
                heatTotal: place.heatTotal,
              });
            }
            resolvedResults.sort((a, b) => a.finish - b.finish);

            if (unmatched.length) {
              allWarnings.push(`${unmatched.length} unmatched ${tour} athlete(s): ${unmatched.map((u) => `${u.displayName} (#${u.finish})`).join("; ")}. Likely rookies/wildcards — add them in the Surfers tab and re-run, or enter manually.`);
            }

            // Count fully-completed rounds (every heat in that round status === "over").
            // Drives the "Round N of M Complete" suffix in the leaderboard-update dialog.
            const byRound = new Map();
            for (const h of heats) {
              if (h.roundNumber == null) continue;
              if (!byRound.has(h.roundNumber)) byRound.set(h.roundNumber, []);
              byRound.get(h.roundNumber).push(h);
            }
            let roundsCompleted = 0;
            for (const [, hs] of byRound) {
              if (hs.every((h) => h.status === "over")) roundsCompleted++;
            }

            scrapedByTour[tour] = { wslEvent, localEvent, resolvedResults, unmatched, totalRounds, roundsCompleted };
            wslLog(`  ${tour} done: ${resolvedResults.length} placements (${unmatched.length} unmatched, ${roundsCompleted}/${totalRounds} rounds complete).`);
          }

          wslFetchOut.innerHTML = renderScrapeSummary(scrapedByTour, allWarnings);
          wslLog("Scrape complete. Review the summary, then click Save when ready.");

          document.getElementById("btn-save-scraped")?.addEventListener("click", async () => {
            const saveBtn = document.getElementById("btn-save-scraped");
            saveBtn.disabled = true;
            saveBtn.textContent = "Checking existing results…";
            try {
              // Pre-check: any existing results in target events?
              const existingByTour = {};
              for (const tour of TOURS) {
                const g = scrapedByTour[tour];
                if (!g) continue;
                existingByTour[tour] = await getResults(g.localEvent.id);
              }
              // List the tours that already have non-empty stored results, so
              // the confirm can name them rather than say "this event."
              const overwriteTours = [];
              for (const tour of TOURS) {
                const arr = existingByTour[tour] || [];
                if (arr.some((r) => r.finish || r.withdrawn)) {
                  const g = scrapedByTour[tour];
                  overwriteTours.push({
                    tour,
                    label: tourLabel(tour),
                    eventName: g?.localEvent?.name || "this event",
                  });
                }
              }
              if (overwriteTours.length > 0) {
                const lines = overwriteTours
                  .map((t) => `<li><strong>${t.label}:</strong> ${t.eventName}</li>`).join("");
                const body =
                    `<p>The following event${overwriteTours.length === 1 ? "" : "s"} already ${overwriteTours.length === 1 ? "has" : "have"} saved results in Firestore:</p>`
                  + `<ul style="margin:0.4rem 0 0.6rem 1.2rem;padding:0">${lines}</ul>`
                  + `<p>Overwrite ${overwriteTours.length === 1 ? "it" : "them"} with the scraped data?</p>`
                  + `<p class="text-sm text-muted" style="margin-top:0.5rem">Use this when re-scraping after additional rounds complete. Skip if you've made manual corrections you want to preserve.</p>`;
                const ok = await confirmModal({
                  title: "Overwrite existing results?",
                  bodyHtml: body,
                  confirmLabel: "Overwrite",
                  cancelLabel: "Cancel",
                  confirmTone: "danger",
                });
                if (!ok) {
                  wslLog("Save canceled by admin.", "warn");
                  saveBtn.disabled = false;
                  saveBtn.textContent = "Save Scraped Results to Firestore";
                  return;
                }
              }

              saveBtn.textContent = "Saving…";
              for (const tour of TOURS) {
                const g = scrapedByTour[tour];
                if (!g || !g.resolvedResults.length) continue;
                const batch = g.resolvedResults.map((r) => ({
                  surferId: r.surferId,
                  finish: r.finish,
                  points: r.points,
                  withdrawn: r.withdrawn,
                  season: SEASON,
                  tour,
                }));
                await saveResultsBatch(g.localEvent.id, batch);
                await saveEvent(g.localEvent.id, {
                  resultsEntered: true,
                  resultsSource: "wsl",
                  roundsCompleted: g.roundsCompleted,
                  totalRounds: g.totalRounds,
                });
                wslLog(`Saved ${batch.length} ${tour} results to "${g.localEvent.name}" (${g.roundsCompleted}/${g.totalRounds} rounds).`);
              }
              try { await touchEventsVersion(); } catch {}
              toast("Scraped results saved.", "success");
              saveBtn.textContent = "Saved ✓";
              // Offer the leaderboard recalc now that fresh results landed.
              await promptUpdateLeaderboard(ctx);
            } catch (err) {
              wslLog(`Save failed: ${err.message}`, "error");
              toast(`Save failed: ${err.message}`, "error");
              saveBtn.disabled = false;
              saveBtn.textContent = "Save Scraped Results to Firestore";
            }
          });

        } catch (err) {
          wslLog(`Fatal: ${err.message}`, "error");
          toast(`Fetch failed: ${err.message}`, "error");
        } finally {
          wslFetchBtn.disabled = false;
          wslFetchBtn.textContent = "Fetch & Update Results from WSL";
        }
      });
}
