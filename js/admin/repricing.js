// js/admin/repricing.js — the "Update Values" post-event repricing flow (Surfers tab).
// Lifted from admin.html unchanged; the shell passes a context so it keeps owning
// state + markup: ctx.{surfers, events, activeSurferTour} are current snapshots,
// ctx.reload("surfers") refetches surfers into the shell, ctx.rerender() repaints.
import { fetchSeasonRankings } from "../wsl-scrape.js";
import { nameToKey } from "../wsl-resolve.js";
import { buildCurve, anchorValueForRank, emaStep, tenabilityReport, ALPHA, MAX_CHANGE, VALUE_STEP } from "../pricing.js";
import { SEASON, tourLabel } from "../config.js";
import { formatSalary, escapeHtml, confirmModal, toast } from "../ui.js";
import { db } from "../firebase-config.js";
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

export function wireRepricing(ctx) {
        const valueUpdateBtn = document.getElementById("btn-update-values");
        const valueUpdateSection = document.getElementById("value-update-section");
        const valueUpdateModal = document.getElementById("value-update-modal");
        const closeValueModal = () => { if (valueUpdateModal) valueUpdateModal.style.display = "none"; };
        valueUpdateModal?.querySelector("#value-update-modal-close")?.addEventListener("click", closeValueModal);
        valueUpdateModal?.addEventListener("click", (e) => { if (e.target === valueUpdateModal) closeValueModal(); });

        // Most recent event with results for a tour — its finishes feed the
        // recency wiggle. Pulled from Firestore-backed state already on the page
        // (the event ranks live in the Results tab); no scrape needed for these.
        function latestResultsEvent(tour) {
          return ctx.events
            .filter((e) => (e.tour || "mens") === tour && e.resultsEntered)
            .sort((a, b) => (b.eventNumber || 0) - (a.eventNumber || 0))[0] || null;
        }

        // Full repricing for one tour: fresh season ranks scraped from WSL → each
        // surfer's value takes one EMA step toward its rank-based target. Surfers
        // we can't match to a ranking keep their value.
        async function computeRepricing(tour, log = () => {}) {
          const rankings = await fetchSeasonRankings(tour, SEASON, log);
          const rankByKey = new Map();
          const ambiguous = new Set();
          for (const r of rankings) {
            const key = nameToKey(r.name);
            if (!key) continue;
            if (rankByKey.has(key)) { ambiguous.add(key); continue; }
            rankByKey.set(key, r);
          }

          // The most recent results-bearing event is the cadence marker — one EMA
          // step per event — and its id keys idempotency (re-running the same
          // event recomputes from each surfer's pre-event baseline, never double-
          // steps). Finishes aren't used; the season rank already encodes them.
          const recentEvent = latestResultsEvent(tour);

          const tourSurfers = ctx.surfers.filter((s) => (s.tour || "mens") === tour);
          // Resolve each surfer's season rank first, so the curve is calibrated
          // only over the surfers we can actually price (matched to a ranking) —
          // unmatched/non-CT surfers must not inflate the target pool.
          const resolved = tourSurfers.map((s) => {
            const key = nameToKey(s.name);
            return { s, key, ranking: key ? rankByKey.get(key) : null };
          });
          const curve = buildCurve(tour, resolved.filter((r) => r.ranking).map((r) => r.ranking.rank));

          const warnings = [];
          if (!recentEvent) {
            warnings.push(`No event with results for ${tour} yet — nothing to step from.`);
          }
          if (curve.degenerate) {
            warnings.push(`Pricing curve hit a calibration bound — it's near-linear (the ${tour} target pool is unreachable for the current peak/poolFactor). Adjust POOL_FACTOR.${tour} (or PEAK) in pricing.js.`);
          }
          // Two of OUR surfers sharing a name-key both resolve to the same WSL
          // rank+price and double-count in the curve — flag for cleanup.
          const localKeys = new Map();
          for (const r of resolved) if (r.key && r.ranking) {
            if (!localKeys.has(r.key)) localKeys.set(r.key, []);
            localKeys.get(r.key).push(r.s.name);
          }
          for (const [, names] of localKeys) {
            if (names.length > 1) warnings.push(`Multiple local surfers share a name key (${names.join(", ")}) — they got the same WSL rank/price; verify they aren't duplicates.`);
          }
          const unmatched = [];
          const changes = resolved.map(({ s, key, ranking }) => {
            if (!ranking) {
              unmatched.push(s);
              return { ...s, matched: false, newRank: s.rank ?? null, target: null, base: s.value || 0, newValue: s.value || 0, change: 0 };
            }
            if (ambiguous.has(key)) {
              warnings.push(`Ambiguous ranking match for "${s.name}" — two athletes share that initial + surname; verify.`);
            }
            const newRank = ranking.rank;
            const target = anchorValueForRank(newRank, curve);   // rank-based target the EMA aims at
            // Idempotent baseline: if this event was already priced for this
            // surfer, recompute from the stored pre-event value (valuePrev) so a
            // re-run is a no-op; otherwise step from the current value. No event
            // ⇒ no step.
            const alreadyPriced = recentEvent && s.lastPricedEvent === recentEvent.id;
            const base = alreadyPriced && Number.isFinite(s.valuePrev) ? s.valuePrev : (s.value || 0);
            const newValue = recentEvent ? emaStep(base, target) : (s.value || 0);
            return { ...s, matched: true, newRank, target, base, newValue, change: newValue - (s.value || 0) };
          });

          return { changes, warnings, unmatched, recentEvent };
        }

        valueUpdateBtn?.addEventListener("click", async () => {
          if (!valueUpdateSection || !valueUpdateModal) return;
          const tour = ctx.activeSurferTour;
          const label = tourLabel(tour);
          const modalTitle = valueUpdateModal.querySelector(".modal__title");
          if (modalTitle) modalTitle.textContent = `Update ${label} Values`;

          valueUpdateSection.innerHTML = `<p class="text-muted" style="margin:0">Fetching live ${label.toLowerCase()} rankings from WSL…</p>`;
          valueUpdateModal.style.display = "flex";

          let result;
          try {
            result = await computeRepricing(tour);
          } catch (err) {
            valueUpdateSection.innerHTML = `<p style="margin:0;color:var(--color-error)">Couldn't reprice: ${escapeHtml(err.message)}</p>`;
            return;
          }
          renderRepricePreview(tour, label, result);
        });

        function renderRepricePreview(tour, label, { changes, warnings, unmatched, recentEvent }) {
          const matched = changes.filter((c) => c.matched);
          const modified = matched.filter((c) => c.change !== 0);
          // Tenability over the MATCHED surfers (the set the curve manages), so
          // its internal targetPool matches buildCurve's N and "pool vs target"
          // is an honest read of pool management.
          const ten = tenabilityReport(matched.map((c) => c.newValue), tour);
          const pct = ten.cap ? Math.round((ten.topStartersSum / ten.cap) * 100) : 0;
          const poolPct = ten.targetPool ? Math.round((ten.poolTotal / ten.targetPool) * 100) : 0;
          const tooEasy = ten.affordableStars >= ten.starters;

          const rows = matched
            .sort((a, b) => a.newRank - b.newRank)
            .map((s) => {
              const clr = s.change > 0 ? "color:var(--color-success)" : s.change < 0 ? "color:var(--color-error)" : "color:var(--color-warm-gray)";
              const arrow = s.change > 0 ? "▲" : s.change < 0 ? "▼" : "—";
              const changeStr = s.change !== 0 ? `${s.change > 0 ? "+" : "−"}${formatSalary(Math.abs(s.change))}` : "—";
              return `<tr>
                <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--color-warm-gray)">#${s.newRank}</td>
                <td style="padding:0.2rem 0.4rem">${escapeHtml(s.name || s.id)}</td>
                <td style="padding:0.2rem 0.4rem;text-align:right">${formatSalary(s.value || 0)}</td>
                <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--color-warm-gray)">${formatSalary(s.target)}</td>
                <td style="padding:0.2rem 0.4rem;text-align:right;font-weight:${s.change !== 0 ? "600" : "400"}">${formatSalary(s.newValue)}</td>
                <td style="padding:0.2rem 0.4rem;text-align:right;${clr};font-weight:${s.change !== 0 ? "600" : "400"}">${arrow} ${changeStr}</td>
              </tr>`;
            }).join("");

          const canApply = recentEvent && matched.length;
          const applyBtnHtml = canApply ? `
            <button class="btn" id="btn-apply-repricing" style="background:var(--color-error);color:#fff;border-color:var(--color-error)">
              Apply to ${matched.length} Surfer${matched.length !== 1 ? "s" : ""}
            </button>` : "";

          valueUpdateSection.innerHTML = `
            <div style="background:var(--color-warning-bg);border:1px solid var(--color-warning-border);border-radius:6px;padding:0.6rem 0.8rem;margin-bottom:0.75rem;color:var(--color-warning)">
              <p class="text-sm" style="margin:0 0 0.35rem">
                Each surfer's value is <strong>low-pass filtered</strong> toward a rank-based target — one gentle step per event, with a minimum step size of ${formatSalary(VALUE_STEP)} and a ${formatSalary(MAX_CHANGE)} backstop:
              </p>
              <div class="text-sm" style="text-align:center;margin:0 0 0.35rem"><code>new = α · target + (1 − α) · previous</code></div>
              <ul class="text-sm" style="margin:0;padding-left:1.15rem">
                <li><strong>α</strong> = ${ALPHA} — smoothing factor (higher → faster, larger steps)</li>
                <li><strong>target</strong> — where the surfer's live WSL season rank sits on the pool-managed curve</li>
                <li><strong>previous</strong> — the surfer's current value${recentEvent ? ` (${escapeHtml(recentEvent.name)})` : ""}</li>
              </ul>
              ${recentEvent ? "" : `<p class="text-sm" style="margin:0.35rem 0 0"><em>No event with results for this tour yet — nothing to step.</em></p>`}
            </div>
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.6rem">
              <div style="flex:1 1 200px;background:var(--color-cream);border:1px solid var(--color-beige);border-radius:6px;padding:0.5rem 0.7rem">
                <div class="text-sm text-muted">Top ${ten.starters} cost vs cap</div>
                <div style="font-weight:600">${formatSalary(ten.topStartersSum)} / ${formatSalary(ten.cap)} <span class="text-sm" style="color:var(--color-warm-gray)">(${pct}%)</span></div>
                <div class="text-sm" style="color:${tooEasy ? "var(--color-error)" : "var(--color-success)"}">${tooEasy ? "⚠ a superteam fits under the cap" : `affordable stars: top ${ten.affordableStars} of ${ten.starters}`}</div>
              </div>
              <div style="flex:1 1 200px;background:var(--color-cream);border:1px solid var(--color-beige);border-radius:6px;padding:0.5rem 0.7rem">
                <div class="text-sm text-muted">Pool total vs target <span class="text-sm" style="color:var(--color-warm-gray)">(converges over events)</span></div>
                <div style="font-weight:600">${formatSalary(ten.poolTotal)} / ${formatSalary(ten.targetPool)} <span class="text-sm" style="color:var(--color-warm-gray)">(${poolPct}%)</span></div>
                <div class="text-sm" style="color:var(--color-warm-gray)">${matched.length} matched${unmatched.length ? `, ${unmatched.length} unmatched` : ""}</div>
              </div>
            </div>
            ${warnings.length ? `<ul class="text-sm" style="margin:0 0 0.5rem;padding-left:1.1rem;color:var(--color-warning)">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}
            ${unmatched.length ? `<p class="text-sm text-muted" style="margin:0 0 0.5rem">Unmatched (value unchanged): ${unmatched.map((u) => escapeHtml(u.name)).join(", ")}. Check name spelling or add them to our roster.</p>` : ""}
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.4rem">
              <h4 style="margin:0">${modified.length} of ${matched.length} surfers change price</h4>
              ${applyBtnHtml}
            </div>
            <div style="overflow-x:auto;border:1px solid var(--color-beige);border-radius:6px;background:#fff;max-height:360px;overflow-y:auto">
              <table style="width:100%;font-size:0.8rem;border-collapse:collapse">
                <thead><tr style="background:var(--color-cream);position:sticky;top:0">
                  <th style="padding:0.3rem 0.4rem;text-align:right">Rank</th>
                  <th style="padding:0.3rem 0.4rem;text-align:left">Surfer</th>
                  <th style="padding:0.3rem 0.4rem;text-align:right">Current $</th>
                  <th style="padding:0.3rem 0.4rem;text-align:right">Target $</th>
                  <th style="padding:0.3rem 0.4rem;text-align:right">New $</th>
                  <th style="padding:0.3rem 0.4rem;text-align:right">Δ</th>
                </tr></thead>
                <tbody>${rows || `<tr><td colspan="6" style="padding:0.5rem;text-align:center;color:var(--color-warm-gray)">No matched surfers.</td></tr>`}</tbody>
              </table>
            </div>
          `;

          document.getElementById("btn-apply-repricing")?.addEventListener("click", async () => {
            const confirmed = await confirmModal({
              title: `Apply ${label} Value Changes?`,
              bodyHtml: `<p>This steps value and updates season rank for <strong>${matched.length}</strong> ${label} surfer${matched.length !== 1 ? "s" : ""} in Firestore (<strong>${modified.length}</strong> price change${modified.length !== 1 ? "s" : ""}).</p><p style="margin-top:0.5rem" class="text-sm text-muted">Unmatched surfers are left untouched. Re-running the same event is safe (idempotent).</p>`,
              confirmLabel: "Apply Changes",
              cancelLabel: "Cancel",
              confirmTone: "danger",
            });
            if (!confirmed) return;
            const applyBtn = document.getElementById("btn-apply-repricing");
            applyBtn.disabled = true;
            applyBtn.textContent = "Applying…";
            try {
              const batch = writeBatch(db);
              for (const s of matched) {
                batch.update(doc(db, "surfers", s.id), {
                  value: s.newValue,
                  rank: s.newRank,
                  valuePrev: s.base,
                  lastPricedEvent: recentEvent.id,
                });
              }
              await batch.commit();
              await ctx.reload("surfers");
              toast(`${label} values updated! ${modified.length} price change${modified.length !== 1 ? "s" : ""} applied.`, "success");
              closeValueModal();
              ctx.rerender();
            } catch (err) {
              toast("Error applying values: " + err.message, "error");
              applyBtn.disabled = false;
              applyBtn.textContent = `Apply to ${matched.length} Surfer${matched.length !== 1 ? "s" : ""}`;
            }
          });
        }
}
