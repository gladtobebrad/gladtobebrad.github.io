// js/admin/players.js — Players tab: refresh directory + reset-all-teams.
import { savePlayerDirectory, clearAllTeams } from "../db.js";
import { confirmModal, toast } from "../ui.js";

export function wirePlayers(ctx) {
  document.getElementById("btn-reset-teams")?.addEventListener("click", async () => {
    if (!(await confirmModal({
      title: "Reset ALL teams?",
      bodyHtml: "<p>This permanently deletes <strong>every team roster for every user and event</strong>. This cannot be undone.</p>",
      confirmLabel: "Delete all rosters",
      confirmTone: "danger",
      requireText: "RESET",
    }))) return;
    try {
      const count = await clearAllTeams();
      toast(`All teams cleared (${count} rosters deleted).`, "success");
    } catch (err) { toast("Reset failed (" + err.message + "). Re-running is safe — it deletes whatever remains.", "error"); }
  });

  document.getElementById("btn-refresh-directory")?.addEventListener("click", async () => {
    try {
      const snapshot = ctx.users.map(u => ({
        id: u.id,
        displayName: u.displayName || "Anonymous",
        teamName: u.teamName || "",
        avatarUrl: u.avatarUrl || u.photoUrl || ""
      }));
      await savePlayerDirectory(snapshot);
      toast(`Player directory updated (${snapshot.length} players).`, "success");
    } catch (err) { toast("Error: " + err.message, "error"); }
  });
}
