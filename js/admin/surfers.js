// js/admin/surfers.js — Surfers tab: tour sub-tabs, add/edit/delete modal, status select.
import { saveSurfer, deleteSurfer } from "../db.js";
import { PEAK, WILDCARD_VALUE, RANKED_FLOOR } from "../pricing.js";
import { confirmModal, toast, escapeHtml, safeUrl } from "../ui.js";

export function wireSurfers(ctx) {
  // ── SURFER TOUR SUB-TABS ──
  ctx.container.querySelectorAll("[data-surfer-tour]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ctx.set({ activeSurferTour: btn.dataset.surferTour });
      ctx.rerender();
    });
  });

  // ── SURFER MODAL ──
  const surferModal = document.getElementById("surfer-modal");
  const openSurferModal = (s) => {
    const preview = document.getElementById("surfer-photo-preview");
    if (s) {
      document.getElementById("surfer-edit-id").value = s.id;
      document.getElementById("surfer-id").value = s.id;
      document.getElementById("surfer-id").disabled = true;
      document.getElementById("surfer-name").value = s.name || "";
      document.getElementById("surfer-country").value = s.country || "";
      document.getElementById("surfer-rank").value = s.rank || "";
      document.getElementById("surfer-value").value = s.value || 0;
      document.getElementById("surfer-tour").value = s.tour || "mens";
      document.getElementById("surfer-stance").value = s.stance || "";
      document.getElementById("surfer-photo").value = s.photoUrl || "";
      preview.innerHTML = s.photoUrl ? `<img src="${escapeHtml(safeUrl(s.photoUrl))}" class="surfer-photo--sm" alt="">` : "";
      document.getElementById("surfer-form-title").textContent = "Edit Surfer";
    } else {
      document.getElementById("surfer-form").reset();
      document.getElementById("surfer-edit-id").value = "";
      document.getElementById("surfer-id").disabled = false;
      preview.innerHTML = "";
      document.getElementById("surfer-form-title").textContent = "Add Surfer";
    }
    surferModal.style.display = "flex";
  };
  const closeSurferModal = () => { surferModal.style.display = "none"; };

  document.getElementById("btn-add-surfer")?.addEventListener("click", () => openSurferModal(null));
  document.getElementById("surfer-modal-close")?.addEventListener("click", closeSurferModal);
  document.getElementById("surfer-modal-cancel")?.addEventListener("click", closeSurferModal);
  surferModal?.addEventListener("click", (e) => { if (e.target === surferModal) closeSurferModal(); });

  document.getElementById("surfer-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const editId = document.getElementById("surfer-edit-id").value;
    const id = editId || document.getElementById("surfer-id").value.trim();
    if (!id) return;
    const value = parseInt(document.getElementById("surfer-value").value, 10) || 0;
    const data = {
      name: document.getElementById("surfer-name").value.trim(),
      country: document.getElementById("surfer-country").value.trim().toUpperCase(),
      rank: parseInt(document.getElementById("surfer-rank").value, 10) || null,
      value,
      tour: document.getElementById("surfer-tour").value,
      stance: document.getElementById("surfer-stance").value || null,
      photoUrl: document.getElementById("surfer-photo").value.trim() || null
    };
    // For new surfers, set defaults for fields managed via inline selects
    if (!editId) {
      data.status = "active";
      data.active = true;
    }
    if (data.value % 250000 !== 0) {
      toast(`Value must be a multiple of $250,000 (e.g. $${(Math.round(data.value / 250000) * 250000).toLocaleString()})`, "error");
      return;
    }
    if (data.value !== WILDCARD_VALUE && data.value < RANKED_FLOOR) {
      toast(`Surfers are priced at $${WILDCARD_VALUE / 1_000_000}M (wildcard) or $${RANKED_FLOOR / 1_000_000}M+ — nothing in between.`, "error");
      return;
    }
    const peakCeiling = PEAK;
    if (data.value > peakCeiling) {
      toast(`Value can't exceed the $${peakCeiling / 1_000_000}M ceiling (the #1 curve value).`, "error");
      return;
    }
    // A manual value change re-baselines the EMA filter: clear the idempotency
    // stamp so the next reprice steps from this hand-set value (not the stored
    // pre-event baseline of an already-priced event).
    const prevSurfer = editId ? ctx.surfers.find((x) => x.id === editId) : null;
    if (!prevSurfer || prevSurfer.value !== data.value) data.lastPricedEvent = null;
    try {
      await saveSurfer(id, data);
      toast("Surfer saved!", "success");
      closeSurferModal();
      await ctx.reload("surfers");
      ctx.rerender();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });

  ctx.container.querySelectorAll("[data-edit-surfer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = ctx.surfers.find((x) => x.id === btn.dataset.editSurfer);
      if (!s) return;
      openSurferModal(s);
    });
  });

  ctx.container.querySelectorAll("[data-delete-surfer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!(await confirmModal({
        title: "Delete surfer?",
        bodyHtml: "<p>This permanently deletes the surfer.</p>",
        confirmLabel: "Delete surfer",
        confirmTone: "danger",
      }))) return;
      await deleteSurfer(btn.dataset.deleteSurfer);
      toast("Surfer deleted.", "info");
      await ctx.reload("surfers");
      ctx.rerender();
    });
  });

  // ── INLINE SURFER STATUS SELECT ──
  ctx.container.querySelectorAll("[data-status-surfer]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const surferId = sel.dataset.statusSurfer;
      const prev = sel.dataset.current;
      try {
        await saveSurfer(surferId, { status: sel.value, active: sel.value !== "inactive" });
        toast(`Status updated to "${sel.value}".`, "success");
        await ctx.reload("surfers");
        ctx.rerender();
      } catch (err) {
        toast("Error: " + err.message, "error");
        sel.value = prev;
      }
    });
  });
}
