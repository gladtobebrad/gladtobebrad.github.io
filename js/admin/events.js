// js/admin/events.js — Events tab: create/edit modal (incl. both-tour dual-save),
// edit/delete/status handlers, and the trading-toggle multi-step stepper
// (lock + opt-in carry-forward + opt-in popularity snapshot).
import { saveEvent, deleteEvent, getTeamsForEvent, lockTeamsForEvent, carryForwardTeams, touchEventsVersion } from "../db.js";
import { SEASON, tourLabel } from "../config.js";
import { confirmModal, toast } from "../ui.js";

export function wireEvents(ctx) {
      // ── EVENT MODAL ──
      const eventModal = document.getElementById("event-modal");
      const openEventModal = (ev) => {
        if (ev) {
          document.getElementById("event-edit-id").value = ev.id;
          document.getElementById("event-id").value = ev.id;
          document.getElementById("event-id").disabled = true;
          document.getElementById("event-name").value = ev.name || "";
          document.getElementById("event-location").value = ev.location || "";
          document.getElementById("event-number").value = ev.eventNumber || "";
          document.getElementById("event-tour").value = ev.tour || "mens";
          document.getElementById("event-start").value = (ev.startDate || "").substring(0, 10);
          document.getElementById("event-end").value = (ev.endDate || "").substring(0, 10);
          document.getElementById("event-trading-close").value = ev.tradingCloseTime || "";
          document.getElementById("event-timezone").value = ev.tradingCloseTimezone || "";
          document.getElementById("event-form-title").textContent = "Edit Event";
        } else {
          document.getElementById("event-form").reset();
          document.getElementById("event-edit-id").value = "";
          document.getElementById("event-id").disabled = false;
          document.getElementById("event-form-title").textContent = "Add Event";
        }
        eventModal.style.display = "flex";
      };
      const closeEventModal = () => { eventModal.style.display = "none"; };

      document.getElementById("btn-add-event")?.addEventListener("click", () => openEventModal(null));
      document.getElementById("event-modal-close")?.addEventListener("click", closeEventModal);
      document.getElementById("event-modal-cancel")?.addEventListener("click", closeEventModal);
      eventModal?.addEventListener("click", (e) => { if (e.target === eventModal) closeEventModal(); });

      document.getElementById("event-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const editId = document.getElementById("event-edit-id").value;
        const id = editId || document.getElementById("event-id").value.trim();
        if (!id) return;
        const tourValue = document.getElementById("event-tour").value;
        const baseData = {
          name: document.getElementById("event-name").value.trim(),
          location: document.getElementById("event-location").value.trim(),
          eventNumber: parseInt(document.getElementById("event-number").value, 10),
          startDate: document.getElementById("event-start").value,
          endDate: document.getElementById("event-end").value,
          tradingCloseTime: document.getElementById("event-trading-close").value || null,
          tradingCloseTimezone: document.getElementById("event-timezone").value || null,
          season: SEASON
        };
        try {
          if (tourValue === "both") {
            const baseId = id.replace(/-mens$|-womens$/, "");
            await saveEvent(baseId + "-mens",   { ...baseData, tour: "mens" });
            await saveEvent(baseId + "-womens", { ...baseData, tour: "womens" });
            toast("Saved Men's + Women's events!", "success");
          } else {
            await saveEvent(id, { ...baseData, tour: tourValue });
            toast("Event saved!", "success");
          }
          try { await touchEventsVersion(); } catch {}
          closeEventModal();
          await ctx.reload("events");
          ctx.rerender();
        } catch (err) {
          toast("Error: " + err.message, "error");
        }
      });

      ctx.container.querySelectorAll("[data-edit-event]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ev = ctx.events.find((e) => e.id === btn.dataset.editEvent);
          if (!ev) return;
          openEventModal(ev);
        });
      });

      ctx.container.querySelectorAll("[data-delete-event]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!(await confirmModal({
            title: "Delete event?",
            bodyHtml: "<p>This permanently deletes the event. This cannot be undone.</p>",
            confirmLabel: "Delete event",
            confirmTone: "danger",
          }))) return;
          await deleteEvent(btn.dataset.deleteEvent);
          try { await touchEventsVersion(); } catch {}
          toast("Event deleted.", "info");
          await ctx.reload("events");
          ctx.rerender();
        });
      });

      // ── INLINE STATUS SELECT ──
      ctx.container.querySelectorAll("[data-status-event]").forEach((sel) => {
        sel.addEventListener("change", async () => {
          const eventId = sel.dataset.statusEvent;
          try {
            await saveEvent(eventId, { status: sel.value });
            toast(`Status updated to "${sel.value}".`, "success");
            try { await touchEventsVersion(); } catch {}
            await ctx.reload("events");
            ctx.rerender();
          } catch (err) {
            toast("Error: " + err.message, "error");
            // Revert the select to the previous value
            const ev = ctx.events.find((e) => e.id === eventId);
            if (ev) sel.value = ev.status;
          }
        });
      });

      // ── TRADING TOGGLE ──
      ctx.container.querySelectorAll("[data-toggle-trading]").forEach((label) => {
        const checkbox = label.querySelector("input");
        const labelText = label.querySelector(".toggle__label");
        // Use click + preventDefault so the browser does NOT auto-flip the
        // checkbox visual on mousedown. We flip it ourselves only after the
        // admin commits step 1, so the toggle stays in its pre-click color
        // (green for "Open", red for "Locked") throughout the dialog flow.
        checkbox.addEventListener("click", async (evt) => {
          evt.preventDefault();
          const eventId = label.dataset.toggleTrading;
          const ev = ctx.events.find((e) => e.id === eventId);
          // Derive intent from the persisted event data (single source of
          // truth). Reading checkbox.checked is fragile because some browsers
          // toggle the property in unexpected places relative to preventDefault.
          // Treat a missing tradingOpen field as "open" (matches the render and
          // the initial seed in the events list).
          const wasOpen = ev?.tradingOpen !== false;
          const locking = wasOpen; // open → click means lock; locked → means open
          const evName = ev?.name || eventId;
          const evTour = ev?.tour || "mens";
          const tourName = tourLabel(evTour);
          const evNumLabel = ev?.eventNumber ? `${tourName} Event ${ev.eventNumber}` : tourName;
          // Synchronous check (events already loaded): is there an earlier locked
          // event on the same tour that carry-forward could pull from? If not,
          // skip the second confirm — nothing to carry.
          const currentNum = ev?.eventNumber ?? Infinity;
          const hasPriorLocked = ctx.events.some(
            (e) => (e.tour || "mens") === evTour
              && e.eventNumber < currentNum
              && e.tradingOpen === false
          );

          // Stepper labels. Carry-forward only appears if there's a source.
          // Popularity snapshot only on the lock path.
          const steps = [locking ? "Lock trading" : "Open trading"];
          if (hasPriorLocked) steps.push("Carry forward");
          if (locking) steps.push("Popularity");
          const stepIdx = { action: 1, carry: hasPriorLocked ? 2 : null, pop: hasPriorLocked ? 3 : 2 };

          // ── STEP 1: confirm the toggle action itself ──
          const dialog1Body = locking
            ? `<p>You're about to lock trading for <strong>"${evName}"</strong> (${evNumLabel}).</p>`
              + `<p>This will:</p>`
              + `<ul>`
              + `<li>Freeze all submitted teams — users can no longer add, drop, or swap surfers for this event.</li>`
              + `</ul>`
              + `<p class="text-sm text-muted" style="margin-top:0.75rem">You'll be asked separately about carry-forward and the popularity snapshot.</p>`
            : `<p>You're about to open trading for <strong>"${evName}"</strong> (${evNumLabel}).</p>`
              + `<p>This will:</p>`
              + `<ul>`
              + `<li>Unfreeze teams so users can edit their roster for this event.</li>`
              + `</ul>`
              + (hasPriorLocked
                ? `<p class="text-sm text-muted" style="margin-top:0.75rem">You'll be asked separately about carry-forward.</p>`
                : "");
          const dialog1Confirmed = await confirmModal({
            title: locking ? "Lock trading?" : "Open trading?",
            bodyHtml: dialog1Body,
            confirmLabel: locking ? "Lock trading" : "Open trading",
            cancelLabel: "Cancel",
            confirmTone: locking ? "danger" : "primary",
            steps,
            currentStep: stepIdx.action
          });
          if (!dialog1Confirmed) {
            // preventDefault held the checkbox in its pre-click state, so
            // there's nothing to revert visually. Just bail.
            return;
          }
          // Step 1 committed → flip the toggle visual + label now. The
          // remaining dialogs are opt-ins for additional side effects; they
          // do not change whether the lock/open happens.
          checkbox.checked = !locking;
          labelText.textContent = locking ? "Locked" : "Open";

          // ── STEP 2: opt-in for carry-forward (only if there's a source) ──
          let shouldCarryForward = false;
          if (hasPriorLocked) {
            const cfChoiceCopy = locking
              ? `For each user who didn't submit a team for <strong>"${evName}"</strong>, copy their most recent locked roster (purchase prices preserved) into this event. User-saved teams are never overwritten. This is the normal end-of-trading flow.`
              : `Pre-populate <strong>"${evName}"</strong> with each user's most recent locked roster. When users open My Team, they'll see their last-event roster with updated market-value deltas (no blank teams). User-saved teams are never overwritten.`;
            const skipChoiceCopy = locking
              ? `Use this if you're re-locking after an accidental Open, or don't want stale rosters scored here.`
              : `Use this if you opened by mistake, or if users should explicitly re-pick.`;
            const dialog2Body =
              `<p>Should we also carry forward rosters from the previous event into <strong>"${evName}"</strong>?</p>`
              + `<div class="confirm-modal__choice">`
              +   `<span class="confirm-modal__choice-label">Carry forward</span>`
              +   `${cfChoiceCopy}`
              + `</div>`
              + `<div class="confirm-modal__choice confirm-modal__choice--alt">`
              +   `<span class="confirm-modal__choice-label">Skip</span>`
              +   `${skipChoiceCopy}`
              + `</div>`;
            shouldCarryForward = await confirmModal({
              title: "Carry forward rosters?",
              bodyHtml: dialog2Body,
              confirmLabel: "Carry forward",
              cancelLabel: "Skip",
              confirmTone: "primary",
              steps,
              currentStep: stepIdx.carry
            });
          }

          // ── STEP 3 (LOCK ONLY): opt-in for popularity snapshot ──
          let shouldSnapshotPopularity = false;
          if (locking) {
            const dialog3Body =
              `<p>Should we also snapshot surfer popularity for <strong>"${evName}"</strong>?</p>`
              + `<div class="confirm-modal__choice">`
              +   `<span class="confirm-modal__choice-label">Snapshot</span>`
              +   `Count how many users picked each surfer, compute % of teams, and save the snapshot to the event doc. This drives the popularity % column on the Surfers page. Required if this is the final lock for this event.`
              + `</div>`
              + `<div class="confirm-modal__choice confirm-modal__choice--alt">`
              +   `<span class="confirm-modal__choice-label">Skip</span>`
              +   `Don't capture popularity now. Use this if you're temporarily re-locking after an accidental Open and a real snapshot already exists, or if you want to redo it later.`
              + `</div>`;
            shouldSnapshotPopularity = await confirmModal({
              title: "Snapshot popularity?",
              bodyHtml: dialog3Body,
              confirmLabel: "Snapshot",
              cancelLabel: "Skip",
              confirmTone: "primary",
              steps,
              currentStep: stepIdx.pop
            });
          }

          // Visual already flipped at step 1 commit. Persist now.
          try {
            await saveEvent(eventId, { tradingOpen: !locking });
            // Keep the local events array in sync so a follow-up click that
            // lands while team ops are still in flight reads the just-saved
            // state, not the stale pre-save value.
            const idx = ctx.events.findIndex((e) => e.id === eventId);
            if (idx >= 0) ctx.events[idx] = { ...ctx.events[idx], tradingOpen: !locking };
          } catch (err) {
            toast("Error saving trading status: " + err.message, "error");
            // Persist failed — roll back the toggle + label to original state.
            checkbox.checked = locking;
            labelText.textContent = locking ? "Open" : "Locked";
            return;
          }
          // Team operations may fail if Firestore rules don't allow admin writes to teams/
          try {
            const carried = shouldCarryForward ? await carryForwardTeams(eventId, SEASON) : 0;
            if (locking) {
              await lockTeamsForEvent(eventId, true);

              let popularityNote = "";
              if (shouldSnapshotPopularity) {
                const teams = await getTeamsForEvent(eventId);
                const totalTeams = teams.length;
                const surferCounts = {};
                for (const team of teams) {
                  const surferIds = new Set();
                  if (team.surfers) team.surfers.forEach(s => surferIds.add(s.surferId));
                  if (team.alternate) surferIds.add(team.alternate.surferId);
                  for (const sid of surferIds) surferCounts[sid] = (surferCounts[sid] || 0) + 1;
                }
                const popularityPct = {};
                for (const [sid, count] of Object.entries(surferCounts)) {
                  popularityPct[sid] = totalTeams > 0
                    ? parseFloat(((count / totalTeams) * 100).toFixed(1))
                    : 0;
                }
                await saveEvent(eventId, { popularityPct, totalTeams });
                popularityNote = ` Popularity snapshot saved (${totalTeams} team${totalTeams === 1 ? "" : "s"}).`;
              }
              const carriedNote = carried > 0 ? ` ${carried} roster(s) carried forward.` : "";
              toast(`Trading locked.${carriedNote}${popularityNote}`, "success");
            } else {
              await lockTeamsForEvent(eventId, false);
              toast(`Trading opened.${carried > 0 ? ` ${carried} roster(s) carried forward.` : ""}`, "success");
            }
          } catch (err) {
            toast((locking ? "Trading locked, but team operations failed" : "Trading opened, but team unlock failed") + " — re-run the toggle to finish. " + err.message, "warning");
          }
          try { await touchEventsVersion(); } catch {}
          await ctx.reload("events");
          ctx.rerender();
        });
      });
}
