import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, setDoc, getDocs, updateDoc,
  writeBatch, serverTimestamp, deleteDoc, arrayUnion, arrayRemove,
  query, where
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// ── Surfers ──────────────────────────────────────────

export async function getSurfers() {
  const snap = await getDocs(collection(db, "surfers"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.active !== false);
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
  const snap = await getDocs(collection(db, "events"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.season === season)
    .sort((a, b) => (a.eventNumber || 0) - (b.eventNumber || 0));
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
// previous team for the same tour. Called automatically when trading is locked.
export async function carryForwardTeams(eventId, season = 2026) {
  const [allUsers, existingTeams, events] = await Promise.all([
    getAllUsers(),
    getTeamsForEvent(eventId),
    getEvents(season),
  ]);
  const currentEvent = events.find((e) => e.id === eventId);
  if (!currentEvent) return 0;
  const tour = currentEvent.tour || "mens";
  const currentNum = currentEvent.eventNumber ?? Infinity;
  const prevEvents = events
    .filter((e) => (e.tour || "mens") === tour && e.eventNumber < currentNum && e.status === "completed")
    .sort((a, b) => b.eventNumber - a.eventNumber);

  const submittedUserIds = new Set(existingTeams.map((t) => t.userId));
  let carried = 0;
  for (const user of allUsers) {
    if (submittedUserIds.has(user.id)) continue;
    // Find most recent team for this user on this tour
    let prevTeam = null;
    for (const ev of prevEvents) {
      const t = await getTeam(user.id, ev.id);
      if (t?.surfers?.length) { prevTeam = t; break; }
    }
    if (!prevTeam) continue;
    await saveTeam(user.id, eventId, {
      surfers: prevTeam.surfers,
      alternate: prevTeam.alternate || null,
      carriedForward: true,
    });
    carried++;
  }
  return carried;
}

// ── Leaderboard ──────────────────────────────────────

// In-memory version cache — one Firestore read per session to check freshness
let _lbVersion = null;

async function fetchLeaderboardVersion() {
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
  _lbVersion = version;
  try {
    Object.keys(localStorage).filter(k => k.startsWith("lb_")).forEach(k => localStorage.removeItem(k));
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

export async function clearLeaderboard(season, tour) {
  const snap = await getDocs(collection(db, "leaderboard"));
  const batch = writeBatch(db);
  snap.docs
    .filter((d) => {
      const data = d.data();
      if (data.season !== season) return false;
      // Delete matching tour OR legacy entries with no tour field
      return data.tour === tour || data.tour == null;
    })
    .forEach((d) => batch.delete(d.ref));
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
  // All completed events of the same tour before the current one, most recent first
  const currentEvent = events.find((e) => e.id === currentEventId);
  const currentNum = currentEvent?.eventNumber ?? Infinity;
  const candidates = events
    .filter((e) => e.tour === tour && e.eventNumber < currentNum && e.status === "completed")
    .sort((a, b) => b.eventNumber - a.eventNumber);
  for (const ev of candidates) {
    const team = await getTeam(userId, ev.id);
    if (team?.surfers?.length) return team;
  }
  return null;
}
