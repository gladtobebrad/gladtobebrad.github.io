// Shared event-by-event standings table — the season leaderboard rendered with
// sticky Rank/Player/Total columns + one column per event, used identically by
// the global Standings page and each club's Season Leaderboard (the club view
// is just a filtered subset of rows). Both pass the same normalized entry shape:
//
//   { id, rank, displayName, teamName, avatarUrl,
//     bestNineTotal, allEventsTotal, eventScores: { [eventId]: points } }
//
// rank is 1-based position in the (already-sorted) list — global rank on
// Standings, club-relative rank on a club page. Medals (1/2/3) come from the
// shared .leaderboard-rank--N styling either way.

import { locationForEvent, escapeHtml, safeUrl } from "./ui.js";

// Robust 28px avatar: always render the initial circle, then overlay the photo
// if there's a valid URL. A broken/expired image removes itself (onerror) and
// the initial shows through — so a row is never left with a blank avatar, and
// every avatar is exactly 28px regardless of photo / initial / broken state.
function avatarTile(p) {
  const url = safeUrl(p.avatarUrl);
  const initial = escapeHtml((p.teamName || p.displayName || "?")[0]);
  const img = url
    ? `<img src="${escapeHtml(url)}" alt="" class="avatar-sm" style="position:absolute;inset:0" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<div class="avatar-sm avatar-sm--empty" style="position:relative;overflow:hidden">${initial}${img}</div>`;
}

/**
 * @param {Object}   o
 * @param {Array}    o.players          normalized entries (see shape above), pre-sorted by rank
 * @param {Array}    o.tourEvents       events for this tour, in column order
 * @param {string}   o.scoringMode      "best9" | "all" — picks the Total column + sort key
 * @param {Set}      o.liveEventIds     event ids whose scores are live projections (styled as estimates)
 * @param {string?}  o.highlightUserId  entry id to highlight (the viewer's own row)
 * @param {string}   o.tableId          optional table id
 * @param {number}   o.playerColWidth   Player column width in px (drives the sticky offsets)
 * @returns {string} table HTML
 */
export function renderStandingsTable({
  players, tourEvents, scoringMode, liveEventIds,
  highlightUserId = null, tableId = "", playerColWidth = 176,
}) {
  if (!players.length) return `<p class="text-muted">No players yet.</p>`;
  const scoreLeft = 56 + playerColWidth;
  const totalOf = (p) => (scoringMode === "all" ? p.allEventsTotal : p.bestNineTotal);
  return `
    <div class="scroll-shadow">
      <div class="scroll-wrap" style="overflow-x:auto;position:relative">
        <table class="data-table scroll-table"${tableId ? ` id="${tableId}"` : ""}>
          <thead><tr>
            <th scope="col" style="position:sticky;left:0;z-index:2;background:var(--color-warm-white);box-sizing:border-box;width:56px;padding-left:0.5rem;padding-right:0.5rem;text-align:center">Rank</th>
            <th scope="col" style="position:sticky;left:56px;z-index:2;background:var(--color-warm-white);box-sizing:border-box;width:${playerColWidth}px;padding-left:0.5rem;padding-right:0.5rem">Player</th>
            <th scope="col" class="text-center sortable-col" data-col="score" data-dir="" style="position:sticky;left:${scoreLeft}px;z-index:2;background:var(--color-warm-white);box-sizing:border-box;width:60px;padding-left:0.5rem;padding-right:0.5rem;font-size:0.65rem;line-height:1.15;vertical-align:bottom;cursor:pointer;user-select:none;border-right:2px solid var(--color-beige)">
              <div>${scoringMode === "all" ? "All Events" : "Best 9"}</div>
              <span class="sort-arrow" style="font-size:0.6rem;opacity:0.4">▲▼</span>
            </th>
            ${tourEvents.map(e => `
              <th scope="col" class="text-center sortable-col evt-col" data-col="evt_${e.id}" data-dir="" title="${escapeHtml(e.name)}" style="cursor:pointer;user-select:none;font-size:0.65rem;line-height:1.15;vertical-align:bottom">
                <div>${escapeHtml(locationForEvent(e.name))}</div>
                <span class="sort-arrow" style="font-size:0.6rem;opacity:0.4">▲▼</span>
              </th>
            `).join("")}
            <th class="scroll-spacer" aria-hidden="true"></th>
          </tr></thead>
          <tbody>
            ${players.map(p => `
              <tr class="${p.id === highlightUserId ? "highlight" : ""}" style="cursor:pointer" onclick="window.location.href='profile.html?id=${encodeURIComponent(p.id)}'"
                data-score="${totalOf(p)}"
                data-search="${escapeHtml(p.teamName.toLowerCase())}"
                ${tourEvents.map(e => `data-evt-${e.id}="${p.eventScores[e.id] ?? -1}"`).join(" ")}>
                <td style="position:sticky;left:0;z-index:1;background:var(--color-warm-white);box-sizing:border-box;width:56px;padding-left:0.5rem;padding-right:0.5rem;text-align:center"><span class="leaderboard-rank leaderboard-rank--${p.rank}">${p.rank}</span></td>
                <td style="position:sticky;left:56px;z-index:1;background:var(--color-warm-white);box-sizing:border-box;width:${playerColWidth}px;padding-left:0.5rem;padding-right:0.5rem">
                  <div class="flex gap-1" style="align-items:center;min-width:0">
                    ${avatarTile(p)}
                    <div style="min-width:0;overflow:hidden">
                      <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.teamName)}</strong>
                    </div>
                  </div>
                </td>
                <td class="text-center" style="position:sticky;left:${scoreLeft}px;z-index:1;background:var(--color-warm-white);box-sizing:border-box;width:60px;padding-left:0.5rem;padding-right:0.5rem;border-right:2px solid var(--color-beige)"><strong>${totalOf(p)}</strong></td>
                ${tourEvents.map(e => {
                  const pts = p.eventScores[e.id];
                  const live = liveEventIds.has(e.id);
                  const hasResults = e.status === "completed" || e.resultsEntered;
                  if (live) {
                    return pts != null
                      ? `<td class="text-center" style="color:var(--color-warm-brown);font-style:italic" title="Projected (live)">~${pts}</td>`
                      : `<td class="text-center" style="color:var(--color-warm-brown)">·</td>`;
                  }
                  if (!hasResults) return `<td class="text-center" style="color:var(--color-warm-brown)">·</td>`;
                  return `<td class="text-center">${pts ?? "—"}</td>`;
                }).join("")}
                <td class="scroll-spacer"></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Wire every standings table inside `container`: click-to-sort on the Total and
 * per-event columns, plus the right-edge scroll-shadow affordance (a fade that
 * appears only when there are more event columns off-screen to the right).
 */
export function wireStandingsTables(container) {
  // Sortable column headers
  container.querySelectorAll(".sortable-col").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const table = th.closest("table");
      const tbody = table.querySelector("tbody");
      const dir = th.dataset.dir === "asc" ? "desc" : "asc";
      table.querySelectorAll(".sortable-col").forEach((h) => {
        h.dataset.dir = "";
        const a = h.querySelector(".sort-arrow");
        if (a) { a.textContent = "▲▼"; a.style.opacity = "0.4"; }
      });
      th.dataset.dir = dir;
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) { arrow.textContent = dir === "asc" ? "▲" : "▼"; arrow.style.opacity = "1"; }
      const rows = [...tbody.querySelectorAll("tr")];
      rows.sort((a, b) => {
        let av, bv;
        if (col.startsWith("evt_")) {
          const evtId = col.slice(4);
          av = parseFloat(a.getAttribute(`data-evt-${evtId}`) ?? -1);
          bv = parseFloat(b.getAttribute(`data-evt-${evtId}`) ?? -1);
        } else {
          av = parseFloat(a.dataset.score ?? 0);
          bv = parseFloat(b.dataset.score ?? 0);
        }
        return dir === "asc" ? av - bv : bv - av;
      });
      rows.forEach((r) => tbody.appendChild(r));
    });
  });

  // Right-edge scroll-shadow — toggled by horizontal scroll position.
  container.querySelectorAll(".scroll-shadow").forEach((shadow) => {
    const wrap = shadow.querySelector(".scroll-wrap");
    if (!wrap) return;
    const update = () => {
      const max = wrap.scrollWidth - wrap.clientWidth;
      shadow.classList.toggle("can-scroll-right", wrap.scrollLeft < max - 1);
    };
    wrap.addEventListener("scroll", update, { passive: true });
    // ResizeObserver also fires when a hidden tour panel (display:none → block)
    // becomes visible, so the fade is correct after a tour-tab switch.
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(update).observe(wrap);
    else window.addEventListener("resize", update);
    update();
  });
}
