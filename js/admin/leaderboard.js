// js/admin/leaderboard.js — the canonical leaderboard-recalc write path (CLAUDE.md).
// recalcLeaderboardForTour is moved BYTE-FOR-BYTE (integrity-critical: compute → validate →
// chunked write via commitInChunks). promptUpdateLeaderboard takes the shell ctx so it can push
// the freshly-fetched events/users back to the shell (ctx.set) after recalc. recalc is internal
// (only promptUpdate calls it); only promptUpdateLeaderboard is exported.
import { getResults, getTeamsForEvent, commitInChunks, getEvents, getAllUsers, touchLeaderboardVersion } from "../db.js";
import { scoreTeam, projectTeam, isInProgress, calculateSeasonStandings } from "../scoring.js";
import { db } from "../firebase-config.js";
import { collection, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { SEASON, TOURS, tourLabel, tourLabelFull } from "../config.js";
import { confirmModal, toast } from "../ui.js";

async function recalcLeaderboardForTour(tour, freshEvents, freshUsers) {
  // Pre-flight: bail (don't write) if we can't compute a meaningful result.
  if (!freshUsers.length) {
    return { tour, status: "skipped", reason: "no registered users" };
  }
  const tourEvents = freshEvents.filter(
    (e) => (e.tour || "mens") === tour && (e.resultsEntered || e.status === "completed")
  );
  if (tourEvents.length === 0) {
    return { tour, status: "skipped", reason: "no events with results entered" };
  }

  // Build empty seed entries for every registered user — ensures players
  // who haven't picked any team still appear in standings (with 0s).
  const userScores = {};
  for (const u of freshUsers) {
    userScores[u.id] = {
      displayName: u.displayName || "",
      teamName: u.teamName || u.displayName || "",
      avatarUrl: u.avatarUrl || "",
      eventScores: {},
    };
  }

  // Parallel-fetch all (results, teams) tuples. Any rejection bubbles up
  // and the catch in promptUpdateLeaderboard records "failed" — Firestore
  // is not touched.
  const fetched = await Promise.all(
    tourEvents.map((ev) => Promise.all([getResults(ev.id), getTeamsForEvent(ev.id)]))
  );
  for (let i = 0; i < tourEvents.length; i++) {
    const ev = tourEvents[i];
    const [results, teams] = fetched[i];
    // For an in-progress event, store the projected (floor) score so live
    // standings reflect upside rather than the inverted locked-in total;
    // completed events use the final scoreTeam total. projectTeam falls
    // back to scoreTeam behaviour once every surfer has a result, so this
    // is safe even at the moment an event flips to completed.
    const live = isInProgress(ev);
    for (const team of teams) {
      if (!userScores[team.userId]) continue; // ghost team for an unregistered user — skip
      const score = live ? projectTeam(team, results, tour) : scoreTeam(team, results, tour);
      // Both return 0 for empty rosters; that's intentional and preserves
      // prior gracefully-handled behavior.
      userScores[team.userId].eventScores[ev.id] = score.totalPoints;
    }
  }

  const entries = Object.entries(userScores).map(([userId, data]) => ({ userId, ...data }));
  const newStandings = calculateSeasonStandings(entries);
  if (!newStandings.length) {
    return { tour, status: "skipped", reason: "computed empty standings" };
  }

  // Find existing leaderboard userIds so we can delete orphans (users no
  // longer in `users`) in the same atomic commit.
  const existingSnap = await getDocs(query(
    collection(db, "leaderboard"),
    where("season", "==", SEASON),
    where("tour", "==", tour)
  ));
  const existingUserIds = new Set();
  existingSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.userId) existingUserIds.add(data.userId);
  });
  const newUserIds = new Set(newStandings.map((s) => s.userId));

  // Sets BEFORE deletes so a partial failure across chunks degrades safely
  // (an entry may be stale, never missing). Chunked at <=450 ops because a
  // single writeBatch caps at 500 — a tour past ~500 users would otherwise
  // throw and leave the whole tour unwritten.
  const ops = [];
  for (const entry of newStandings) {
    const docId = `${entry.userId}_${SEASON}_${tour}`;
    ops.push((batch) => batch.set(doc(db, "leaderboard", docId), {
      userId: entry.userId,
      season: SEASON,
      tour,
      displayName: entry.displayName,
      teamName: entry.teamName,
      avatarUrl: entry.avatarUrl || "",
      eventScores: entry.eventScores,
      bestNineTotal: entry.bestNineTotal,
      allEventsTotal: entry.allEventsTotal,
      eventsPlayed: entry.eventsPlayed,
    }));
  }
  for (const oldUserId of existingUserIds) {
    if (!newUserIds.has(oldUserId)) {
      ops.push((batch) => batch.delete(doc(db, "leaderboard", `${oldUserId}_${SEASON}_${tour}`)));
    }
  }
  await commitInChunks(ops);

  return {
    tour,
    status: "updated",
    players: newStandings.length,
    eventsUsed: tourEvents.length,
  };
}

// Confirm-then-recalc dialog. Wired into both result-save flows (WSL
// scrape and manual entry). Always shows the dialog so admin retains
// explicit control; never auto-runs.
export async function promptUpdateLeaderboard(ctx) {
  // Refresh events + users from source so the recalc sees the latest
  // resultsEntered flags and any signups since page load.
  try { sessionStorage.removeItem(`events_${SEASON}`); } catch {}
  let freshEvents, freshUsers;
  try {
    [freshEvents, freshUsers] = await Promise.all([getEvents(SEASON), getAllUsers()]);
  } catch (err) {
    toast("Could not check leaderboard state: " + err.message, "error");
    return;
  }

  // Per-tour summary: count of events with results + the two most-recent
  // events (by eventNumber) labeled Last/Current update so admin can see
  // exactly what's being added.
  // Wrap suffix in white-space:nowrap so phrases like "Round 1 of 6
  // Complete" never split across lines mid-suffix.
  const roundSuffix = (ev) => {
    if (ev.status === "completed") {
      return ` <span style="white-space:nowrap">— Final</span>`;
    }
    if (ev.roundsCompleted && ev.totalRounds) {
      return ` <span style="white-space:nowrap">— Round ${ev.roundsCompleted} of ${ev.totalRounds} Complete</span>`;
    }
    return "";
  };
  const summary = TOURS.map((tour) => {
    const evs = freshEvents
      .filter((e) => (e.tour || "mens") === tour && (e.resultsEntered || e.status === "completed"))
      .sort((a, b) => (b.eventNumber || 0) - (a.eventNumber || 0)); // newest first
    return {
      tour,
      label: tourLabelFull(tour),
      count: evs.length,
      current: evs[0] || null,
      last: evs[1] || null,
    };
  });
  const updatable = summary.filter((s) => s.count > 0);
  if (updatable.length === 0) {
    toast("Nothing to update — no events have results entered yet.", "info");
    return;
  }

  const renderTourBlock = (s) => {
    if (s.count === 0) {
      return `<div style="margin-bottom:0.6rem"><strong>${s.label}:</strong> <span class="text-sm text-muted">no events with results yet — will skip</span></div>`;
    }
    const lastLine = s.last
      ? `<div class="text-sm text-muted">Last: ${s.last.name}${roundSuffix(s.last)}</div>`
      : `<div class="text-sm text-muted">Last: —</div>`;
    const currentLine = `<div class="text-sm text-muted">Now: ${s.current.name}${roundSuffix(s.current)}</div>`;
    return `<div style="margin-bottom:0.6rem">`
      + `<strong>${s.label}:</strong> ${s.count} event${s.count === 1 ? "" : "s"} with results`
      + lastLine + currentLine
      + `</div>`;
  };
  const body =
      `<p>Recalculate team scores and the season leaderboard from the current stored event results?</p>`
    + summary.map(renderTourBlock).join("");

  const confirmed = await confirmModal({
    title: "Update team scores & leaderboard?",
    bodyHtml: body,
    confirmLabel: "Update Now",
    cancelLabel: "Skip",
    confirmTone: "primary",
  });
  if (!confirmed) return;

  const outcomes = [];
  for (const tour of TOURS) {
    try {
      outcomes.push(await recalcLeaderboardForTour(tour, freshEvents, freshUsers));
    } catch (err) {
      // A chunk commit failed mid-recalc. Sets-before-deletes means that
      // tour's entries are stale-but-present (never missing). Record the
      // failure and continue with the other tour.
      outcomes.push({ tour, status: "failed", reason: err.message });
    }
  }

  // Bump leaderboard version so all clients re-fetch from cache.
  if (outcomes.some((o) => o.status === "updated")) {
    try { await touchLeaderboardVersion(); } catch {}
  }

  // Refresh module-level events/users so subsequent admin actions see the
  // same data the recalc used.
  ctx.set({ events: freshEvents, users: freshUsers });

  const parts = outcomes.map((o) => {
    if (o.status === "updated") return `${tourLabel(o.tour)} updated (${o.players} player${o.players === 1 ? "" : "s"}, ${o.eventsUsed} event${o.eventsUsed === 1 ? "" : "s"})`;
    if (o.status === "skipped") return `${tourLabel(o.tour)} skipped (${o.reason})`;
    return `${tourLabel(o.tour)} FAILED: ${o.reason} — re-running Update is safe and completes it`;
  });
  const anyFailed = outcomes.some((o) => o.status === "failed");
  const anyUpdated = outcomes.some((o) => o.status === "updated");
  const tone = anyFailed ? "warning" : anyUpdated ? "success" : "info";
  toast(parts.join(" · "), tone);
}
