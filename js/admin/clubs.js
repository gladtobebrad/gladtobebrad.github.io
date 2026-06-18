// js/admin/clubs.js — Clubs tab: the delete-club (cascade) handler.
import { deleteClub } from "../db.js";
import { confirmModal, toast } from "../ui.js";

export function wireClubs(ctx) {
  ctx.container.querySelectorAll("[data-delete-club]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const clubId = btn.dataset.deleteClub;
      const memberIds = JSON.parse(btn.dataset.clubMembers || "[]");
      if (!(await confirmModal({
        title: "Delete club?",
        bodyHtml: `<p>This deletes the club and removes all ${memberIds.length} member(s). This cannot be undone.</p>`,
        confirmLabel: "Delete club",
        confirmTone: "danger",
      }))) return;
      try {
        await deleteClub(clubId, memberIds);
        toast("Club deleted.", "info");
        await ctx.reload("clubs");
        ctx.rerender();
      } catch (err) {
        toast("Error: " + err.message, "error");
      }
    });
  });
}
