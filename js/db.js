import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, setDoc, getDocs, updateDoc,
  writeBatch, serverTimestamp, deleteDoc, arrayUnion, arrayRemove,
  query, where
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// ── Site Config ─────────────────────────────────────

export async function getSiteConfig() {
  const snap = await getDoc(doc(db, "config", "site"));
  return snap.exists() ? snap.data() : {};
}

export async function saveSiteConfig(data) {
  await setDoc(doc(db, "config", "site"), data, { merge: true });
}

// ── Surfers ──────────────────────────────────────────

export async function getSurfers() {
  const snap = await getDocs(collection(db, "surfers"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => {
      const status = s.status || (s.active === false ? "inactive" : "active");
      return status !== "inactive";
    });
}

export async function getAllSurfers() {
  const snap = await getDocs(collection(db, "surfers"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSurfer(surferId) {
  const snap = await getDoc(doc(db, "surfers", surferId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveSurfer(surferId, data) {
  await setDoc(doc(db, "surfers", surferId), data, { merge: true });
}

export async function deleteSurfer(surferId) {
  await deleteDoc(doc(db, "surfers", surferId));
}

// ── Events ───────────────────────────────────────────

export async function getEvents(season = 2026) {
  const cacheKey = `events_${season}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}
  const snap = await getDocs(collection(db, "events"));
  const data = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.season === season)
    .sort((a, b) => (a.eventNumber || 0) - (b.eventNumber || 0));
  try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
  return data;
}

export async function getEvent(eventId) {
  const snap = await getDoc(doc(db, "events", eventId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getCurrentEvent(season = 2026) {
  const events = await getEvents(season);
  // Try "live" first, then "upcoming"
  return events.find((e) => e.status === "live")
    || events.find((e) => e.status === "upcoming")
    || null;
}

export async function getCurrentEventForTour(tour, season = 2026) {
  const events = await getEvents(season);
  const tourEvents = events.filter((e) => (e.tour || "mens") === tour);
  return tourEvents.find((e) => e.status === "live")
    || tourEvents.find((e) => e.status === "upcoming")
    || null;
}

// Fetch a single event directly from Firestore, bypassing all caches.
// Use this for trading-critical checks where stale data = exploit.
export async function getEventFresh(eventId) {
  const snap = await getDoc(doc(db, "events", eventId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveEvent(eventId, data) {
  await setDoc(doc(db, "events", eventId), data, { merge: true });
}

export async function deleteEvent(eventId) {
  await deleteDoc(doc(db, "events", eventId));
}

// ── Results ──────────────────────────────────────────

export async function getResults(eventId) {
  const snap = await getDocs(query(collection(db, "results"), where("eventId", "==", eventId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function saveResult(eventId, surferId, data) {
  const docId = `${eventId}_${surferId}`;
  await setDoc(doc(db, "results", docId), { eventId, surferId, ...data }, { merge: true });
}

export async function saveResultsBatch(eventId, resultsArray) {
  const batch = writeBatch(db);
  for (const r of resultsArray) {
    const docId = `${eventId}_${r.surferId}`;
    batch.set(doc(db, "results", docId), { eventId, ...r }, { merge: true });
  }
  await batch.commit();
}

export async function clearResults(eventId) {
  const snap = await getDocs(query(collection(db, "results"), where("eventId", "==", eventId)));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ── Teams ────────────────────────────────────────────

export async function getTeam(userId, eventId) {
  const docId = `${userId}_${eventId}`;
  const snap = await getDoc(doc(db, "teams", docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveTeam(userId, eventId, teamData) {
  const docId = `${userId}_${eventId}`;
  await setDoc(doc(db, "teams", docId), {
    userId,
    eventId,
    savedAt: serverTimestamp(),
    ...teamData
  }, { merge: true });
}

export async function getTeamsForEvent(eventId) {
  const snap = await getDocs(query(collection(db, "teams"), where("eventId", "==", eventId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function lockTeamsForEvent(eventId, locked = true) {
  const teams = await getTeamsForEvent(eventId);
  const batch = writeBatch(db);
  for (const t of teams) {
    batch.update(doc(db, "teams", t.id), { locked });
  }
  await batch.commit();
}

export async function clearAllTeams() {
  const snap = await getDocs(collection(db, "teams"));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.docs.length;
}

// For every registered user who has no team for eventId, copy their most recent
// previous team for the same tour. Called when trading is locked on this event
// AND when trading is opened on this event, so users entering event N+1 see the
// team they finished N with (with updated market-value deltas). Admin can opt
// out at either point via the second confirm in the toggle handler.
export async function carryForwardTeams(eventId, season = 2026) {
  // Bypass sessionStorage cache — needs live tradingOpen values to find locked prev events
  try { sessionStorage.removeItem(`events_${season}`); } catch {}
  const [allUsers, existingTeams, events] = await Promise.all([
    getAllUsers(),
    getTeamsForEvent(eventId),
    getEvents(season),
  ]);
  const currentEvent = events.find((e) => e.id === eventId);
  if (!currentEvent) return 0;
  const tour = currentEvent.tour || "mens";
  const currentNum = currentEvent.eventNumber ?? Infinity;
  // Source = previous events on this tour whose trading is locked. Using
  // tradingOpen === false (not status === "completed") removes the order-of-ops
  // dependency on the admin marking status before unlocking the next event.
  const prevEvents = events
    .filter((e) => (e.tour || "mens") === tour && e.eventNumber < currentNum && e.tradingOpen === false)
    .sort((a, b) => b.eventNumber - a.eventNumber);

  if (prevEvents.length === 0) return 0;

  // Batch all reads in parallel, then write everything in a single batch.
  // Previously this loop did N users × M prev events sequential getTeam calls
  // plus N sequential saveTeam writes. For 100 users / 5 prev events that's
  // ~500 round trips — far too slow for an interactive admin action.
  const prevTeamsByEvent = await Promise.all(prevEvents.map((ev) => getTeamsForEvent(ev.id)));

  // Build map: userId → most recent prev team (with surfers). prevEvents is
  // already sorted newest-first, so the first hit per user wins.
  const mostRecentByUser = new Map();
  for (const teamsList of prevTeamsByEvent) {
    for (const t of teamsList) {
      if (!t.surfers || t.surfers.length === 0) continue;
      if (!mostRecentByUser.has(t.userId)) mostRecentByUser.set(t.userId, t);
    }
  }

  const submittedUserIds = new Set(existingTeams.map((t) => t.userId));
  const toWrite = [];
  for (const user of allUsers) {
    if (submittedUserIds.has(user.id)) continue;
    const prevTeam = mostRecentByUser.get(user.id);
    if (!prevTeam) continue;
    toWrite.push({ userId: user.id, prevTeam });
  }

  if (toWrite.length === 0) return 0;

  const batch = writeBatch(db);
  for (const { userId, prevTeam } of toWrite) {
    const docId = `${userId}_${eventId}`;
    batch.set(doc(db, "teams", docId), {
      userId,
      eventId,
      savedAt: serverTimestamp(),
      surfers: prevTeam.surfers,
      alternate: prevTeam.alternate || null,
      carriedForward: true,
    }, { merge: true });
  }
  await batch.commit();
  const carried = toWrite.length;
  return carried;
}

// ── Leaderboard ──────────────────────────────────────

// In-memory version cache — one Firestore read per session to check freshness
let _lbVersion = null;

export async function fetchLeaderboardVersion() {
  if (_lbVersion !== null) return _lbVersion;
  try {
    const snap = await getDoc(doc(db, "meta", "leaderboard"));
    _lbVersion = snap.exists() ? (snap.data().version || 0) : 0;
  } catch {
    _lbVersion = 0;
  }
  return _lbVersion;
}

// Call once after recalculating standings — bumps version so all clients re-fetch
export async function touchLeaderboardVersion() {
  const version = Date.now();
  await setDoc(doc(db, "meta", "leaderboard"), { version });
  _lbVersion = null; // force all clients to re-fetch version after next recalc
  try {
    Object.keys(localStorage).filter(k => k.startsWith("lb_")).forEach(k => localStorage.removeItem(k));
    Object.keys(sessionStorage).filter(k => k.startsWith("events_")).forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

export async function getLeaderboard(season = 2026, tour = null) {
  const cacheKey = `lb_${season}_${tour}`;
  try {
    const serverVersion = await fetchLeaderboardVersion();
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, version } = JSON.parse(cached);
      if (version === serverVersion) return data;
    }
  } catch {}

  const constraints = [where("season", "==", season)];
  if (tour) constraints.push(where("tour", "==", tour));
  const snap = await getDocs(query(collection(db, "leaderboard"), ...constraints));
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  try { localStorage.setItem(cacheKey, JSON.stringify({ data, version: _lbVersion || 0 })); } catch {}
  return data;
}

export async function saveLeaderboardEntry(userId, season, tour, data) {
  const docId = `${userId}_${season}_${tour}`;
  await setDoc(doc(db, "leaderboard", docId), {
    userId,
    season,
    tour,
    ...data
  });
}

// Write all leaderboard entries in a single batch (max 500 ops — fine for 100 users)
export async function saveLeaderboardBatch(entries, season, tour) {
  const batch = writeBatch(db);
  for (const entry of entries) {
    const docId = `${entry.userId}_${season}_${tour}`;
    batch.set(doc(db, "leaderboard", docId), {
      userId: entry.userId,
      season,
      tour,
      displayName: entry.displayName,
      teamName: entry.teamName,
      eventScores: entry.eventScores,
      bestNineTotal: entry.bestNineTotal,
      allEventsTotal: entry.allEventsTotal,
      eventsPlayed: entry.eventsPlayed,
    });
  }
  await batch.commit();
}

export async function clearLeaderboard(season, tour) {
  // Query only the docs we need to delete rather than fetching the whole collection
  const snap = await getDocs(query(collection(db, "leaderboard"), where("season", "==", season), where("tour", "==", tour)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ── Player Directory (meta/players snapshot) ─────────

export async function savePlayerDirectory(players) {
  await setDoc(doc(db, "meta", "players"), { players, updatedAt: Date.now() });
  try { sessionStorage.removeItem("player_directory"); } catch {}
}

export async function getPlayerDirectory() {
  try {
    const cached = sessionStorage.getItem("player_directory");
    if (cached) return JSON.parse(cached);
  } catch {}
  const snap = await getDoc(doc(db, "meta", "players"));
  const players = snap.exists() ? (snap.data().players || []) : [];
  try { sessionStorage.setItem("player_directory", JSON.stringify(players)); } catch {}
  return players;
}

// ── Users ────────────────────────────────────────────

export async function getUser(userId) {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createUser(userId, profile) {
  await setDoc(doc(db, "users", userId), profile);
}

export async function updateUser(userId, data) {
  await updateDoc(doc(db, "users", userId), data);
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Clubs ─────────────────────────────────────────────

function randomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Returns array of club IDs for a user doc (handles old clubId string + new clubIds array)
export function getUserClubIds(userDoc) {
  const ids = new Set(userDoc?.clubIds || []);
  if (userDoc?.clubId) ids.add(userDoc.clubId); // backward compat
  return [...ids];
}

export async function createClub(ownerId, name) {
  const id = randomCode(6);
  const inviteCode = randomCode(6);
  const data = {
    name,
    ownerId,
    inviteCode,
    memberIds: [ownerId],
    createdAt: serverTimestamp()
  };
  await setDoc(doc(db, "clubs", id), data);
  await updateDoc(doc(db, "users", ownerId), { clubIds: arrayUnion(id) });
  return { id, ...data };
}

export async function getAllClubs() {
  const snap = await getDocs(collection(db, "clubs"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getClub(clubId) {
  const snap = await getDoc(doc(db, "clubs", clubId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getClubByInviteCode(code) {
  const snap = await getDocs(collection(db, "clubs"));
  const match = snap.docs.find((d) => d.data().inviteCode === code.toUpperCase());
  return match ? { id: match.id, ...match.data() } : null;
}

export async function joinClub(userId, clubId) {
  await updateDoc(doc(db, "clubs", clubId), { memberIds: arrayUnion(userId) });
  await updateDoc(doc(db, "users", userId), { clubIds: arrayUnion(clubId) });
}

export async function leaveClub(userId, clubId) {
  await updateDoc(doc(db, "clubs", clubId), { memberIds: arrayRemove(userId) });
  await updateDoc(doc(db, "users", userId), { clubIds: arrayRemove(clubId) });
}

export async function deleteClub(clubId, memberIds) {
  const batch = writeBatch(db);
  for (const uid of memberIds) {
    batch.update(doc(db, "users", uid), { clubIds: arrayRemove(clubId) });
  }
  batch.delete(doc(db, "clubs", clubId));
  await batch.commit();
}

// ── Previous team snapshot (for revert) ──────────────

export async function getPreviousTeam(userId, currentEventId, tour, season = 2026) {
  const events = await getEvents(season);
  // Most recent locked event on the same tour before the current one.
  // tradingOpen === false (vs. status === "completed") matches carryForwardTeams
  // so Revert and carry-forward agree on what "previous event" means.
  const currentEvent = events.find((e) => e.id === currentEventId);
  const currentNum = currentEvent?.eventNumber ?? Infinity;
  const candidates = events
    .filter((e) => (e.tour || "mens") === tour && e.eventNumber < currentNum && e.tradingOpen === false)
    .sort((a, b) => b.eventNumber - a.eventNumber);
  for (const ev of candidates) {
    const team = await getTeam(userId, ev.id);
    if (team?.surfers?.length) return team;
  }
  return null;
}
