// WSL website scraping. CORS is permissive (Access-Control-Allow-Origin: *)
// and heat data is server-rendered in the initial HTML, so we can run this
// entirely from the browser via fetch + DOMParser — no backend, no headless.
//
// All exported functions accept an optional `log(msg, level?)` callback so
// the admin UI can stream progress while a scrape is in flight.

const WSL_BASE = "https://www.worldsurfleague.com";
const TOUR_CODE = { MCT: "mens", WCT: "womens" };

async function fetchDoc(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  return new DOMParser().parseFromString(html, "text/html");
}

// Parse the season schedule. The schedule URL shows ONE row per venue —
// whichever gender (MCT or WCT) the WSL chose to feature in its UI. We use
// it solely to pick the target venue (by status). Per-gender statEventIds
// are then discovered via discoverGenders() against the event landing page.
//
// Returns: [{ statEventId, wslEventId, slug, name, primaryTour, status, eventNumber }]
export async function fetchSchedule(season = 2026, log = () => {}) {
  log(`Fetching WSL ${season} CT schedule…`);
  const doc = await fetchDoc(`${WSL_BASE}/events/${season}/ct?all=1`);
  const rows = doc.querySelectorAll('tr[class*="event-"]');
  const events = [];
  for (const row of rows) {
    const cls = row.className || "";
    if (cls.includes("date-row")) continue;
    const m = cls.match(/(?:^|\s)event-(\d+)(?:\s|$)/);
    if (!m) continue;
    const statEventId = parseInt(m[1], 10);

    const anchor = row.querySelector("a.event-schedule-details__event-name");
    if (!anchor) continue;
    const href = anchor.getAttribute("href") || "";
    const hrefM = href.match(/\/events\/\d+\/ct\/(\d+)\/([a-z0-9-]+)/);
    if (!hrefM) continue;
    const wslEventId = parseInt(hrefM[1], 10);
    const slug = hrefM[2];

    // Strip the sponsor span out of the anchor; the remaining text is the name.
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll("span").forEach((s) => s.remove());
    const name = clone.textContent.trim();

    // The schedule features one tour per row (whichever WSL highlighted);
    // we record it as `primaryTour` for diagnostic purposes but otherwise
    // ignore it — per-gender data comes from discoverGenders().
    let primaryTour = null;
    try {
      const gtm = JSON.parse(anchor.getAttribute("data-gtm-event") || "{}");
      primaryTour = TOUR_CODE[gtm.tour_code] || null;
    } catch {}

    const statusEl = row.querySelector('[class*="event-status--"]');
    let status = null;
    if (statusEl) {
      const sm = statusEl.className.match(/event-status--([a-z]+)/);
      status = sm ? sm[1] : null;
    }

    const secondary = row.querySelector(".event-tour-details__secondary");
    let eventNumber = null;
    if (secondary) {
      const en = secondary.textContent.match(/(\d+)/);
      if (en) eventNumber = parseInt(en[1], 10);
    }

    events.push({ statEventId, wslEventId, slug, name, primaryTour, status, eventNumber });
  }
  log(`  Parsed ${events.length} venue rows from schedule.`);
  return events;
}

// Pick the single target venue. Priority: first active (live/on/standby) >
// most recent completed (over). Skip upcoming/canceled. The schedule is in
// chronological order, so the last "over" is the most recently completed.
// Returns one venue entry or null.
export function pickTargetVenue(schedule) {
  const ACTIVE = new Set(["live", "on", "standby"]);
  const eligible = schedule.filter((e) => e.status !== "canceled" && e.status !== "upcoming");
  const active = eligible.find((e) => ACTIVE.has(e.status));
  if (active) return active;
  const completed = eligible.filter((e) => e.status === "over");
  return completed.length ? completed[completed.length - 1] : null;
}

// Fetch the event landing page (no statEventId) and parse the gender-toggle
// anchors. Each gender exposes its own statEventId + a status badge.
// Returns { mens: {statEventId, status}|null, womens: {statEventId, status}|null }.
export async function discoverGenders(venue, season, log = () => {}) {
  const url = `${WSL_BASE}/events/${season}/ct/${venue.wslEventId}/${venue.slug}/results`;
  log(`  Discovering gender statEventIds for "${venue.name}"…`);
  const doc = await fetchDoc(url);
  const out = { mens: null, womens: null };
  // The toggle anchors have title="Men's Heats" / title="Women's Heats" and
  // an href that carries the statEventId. Their visible text concatenates a
  // status label ("Men's HeatsStandby") so we sniff the trailing status from
  // the textContent — falling back to the schedule's status if missing.
  for (const a of doc.querySelectorAll('a[title="Men\'s Heats"], a[title="Women\'s Heats"]')) {
    const title = a.getAttribute("title") || "";
    const href = a.getAttribute("href") || "";
    const sm = href.match(/statEventId=(\d+)/);
    if (!sm) continue;
    const statEventId = parseInt(sm[1], 10);
    const tour = title.startsWith("Men") ? "mens" : "womens";
    const text = (a.textContent || "").replace(/(Men's|Women's)\s*Heats/i, "").trim().toLowerCase();
    const status = text || venue.status || null;
    if (!out[tour]) out[tour] = { statEventId, status };
  }
  log(`    mens=${out.mens ? `stat=${out.mens.statEventId} (${out.mens.status})` : "n/a"}, womens=${out.womens ? `stat=${out.womens.statEventId} (${out.womens.status})` : "n/a"}`);
  return out;
}

// Discover round-tab URLs for a single gender. Returns [{ roundId, label }, ...].
// The event landing page lists tabs as anchors with href*='results?roundId='
// and visible text like "Round 1 4 Heats Completed May 15" — we take the
// first 2 whitespace-separated tokens as the label.
export async function discoverRounds(event, season, log = () => {}) {
  const url = `${WSL_BASE}/events/${season}/ct/${event.wslEventId}/${event.slug}/results?statEventId=${event.statEventId}`;
  log(`  Discovering round tabs for ${event.tour} (statEventId=${event.statEventId})…`);
  const doc = await fetchDoc(url);
  const anchors = doc.querySelectorAll('a[href*="results?roundId="]');
  const seen = new Set();
  const rounds = [];
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/roundId=(\d+)/);
    if (!m) continue;
    const roundId = parseInt(m[1], 10);
    if (seen.has(roundId)) continue;
    seen.add(roundId);
    // The anchor text concatenates the round name with a heat-count summary,
    // e.g. "Round 1 4 Heats Completed May 15" or "Bracket 16 Heats Upcoming".
    // The name is everything before " N Heats".
    const raw = (a.textContent || "").trim().replace(/\s+/g, " ");
    const labelM = raw.match(/^(.*?)\s+\d+\s+Heats/i);
    const label = labelM ? labelM[1].trim() : raw;
    rounds.push({ roundId, label });
  }
  log(`    ${rounds.length} round tab(s): ${rounds.map((r) => r.label).join(", ") || "(none)"}`);
  return rounds;
}

// Parse a single round-tab page into [{ heatId, heatName, status,
// roundNumber, heatNumber, athletes: [...] }]. The bracket-tab page renders
// each heat div twice (one in the bracket tree, one in the heat list); we
// dedupe by heatId.
//
// `defaultRoundNumber` is used when the page renders heats with names like
// "Heat 1" (the Round-N tabs do this — each tab is dedicated to one round
// so there's no round prefix). The Bracket tab uses names like "R2 Heat 1"
// / "QF Heat 1" / "Final" that carry their own round info.
//
// Per athlete: { wslId, displayName, placeInHeat, heatTotal, advanced,
// eliminated, dataStatus }.
export async function fetchRoundHeats(event, season, roundId, defaultRoundNumber = null) {
  const url = `${WSL_BASE}/events/${season}/ct/${event.wslEventId}/${event.slug}/results?roundId=${roundId}&statEventId=${event.statEventId}`;
  const doc = await fetchDoc(url);
  const heatDivs = doc.querySelectorAll('div[class*="hot-heat--heat-id-"]');
  const seenHeats = new Set();
  const heats = [];
  for (const div of heatDivs) {
    const cls = div.className;
    const idM = cls.match(/hot-heat--heat-id-(\d+)/);
    if (!idM) continue;
    const heatId = parseInt(idM[1], 10);
    if (seenHeats.has(heatId)) continue;
    seenHeats.add(heatId);

    const statusM = cls.match(/hot-heat--heat-status-([a-z]+)/);
    const status = statusM ? statusM[1] : null;

    const heatNameEl = div.querySelector(".heat-name");
    const heatName = heatNameEl ? heatNameEl.textContent.trim() : "";

    // Round/heat numbers. The Round-N tabs render heats as plain "Heat 1" —
    // no round prefix in the name, no data-round-number attribute — so we
    // fall back to `defaultRoundNumber` (passed in by the caller, who knows
    // which round tab this is from the tab label). The Bracket tab uses
    // names like "R2 Heat 1" / "QF Heat 1" / "Final" that we resolve later
    // in scrapeEventForGender once we know the bracket's total round count.
    const dataRound = div.getAttribute("data-round-number");
    const dataHeat = div.getAttribute("data-heat-number");
    let roundNumber = dataRound ? parseInt(dataRound, 10) : null;
    let heatNumber = dataHeat ? parseInt(dataHeat, 10) : null;
    if (roundNumber == null && defaultRoundNumber != null && !/R\d+|^QF|^SF|^Final$/i.test(heatName)) {
      roundNumber = defaultRoundNumber;
    }
    if (heatNumber == null) {
      const hm = heatName.match(/Heat\s+(\d+)/i);
      if (hm) heatNumber = parseInt(hm[1], 10);
    }

    const athletes = [];
    const athleteDivs = div.querySelectorAll('div[class*="hot-heat-athlete--athlete-id-"]');
    for (const ad of athleteDivs) {
      const acls = ad.className;
      const idM = acls.match(/hot-heat-athlete--athlete-id-(\d+)/);
      if (!idM) continue;
      const wslId = parseInt(idM[1], 10);

      const placeM = acls.match(/hot-heat-athlete--athlete-place-(\d+)/);
      const placeInHeat = placeM ? parseInt(placeM[1], 10) : null;

      const advanced = /hot-heat-athlete--advance-winner/.test(acls);
      const eliminated = /hot-heat-athlete--eliminated/.test(acls);

      const nameEl = ad.querySelector(".hot-heat-athlete__name--short");
      const displayName = nameEl ? nameEl.textContent.trim() : "";

      const scoreEl = ad.querySelector(".hot-heat-athlete__score");
      const scoreText = scoreEl ? scoreEl.textContent.trim() : "";
      const parsed = parseFloat(scoreText);
      const heatTotal = isNaN(parsed) ? null : parsed;

      const dataStatus = ad.getAttribute("data-athlete-status") || "active";

      athletes.push({
        wslId, displayName, placeInHeat, heatTotal,
        advanced, eliminated, dataStatus,
      });
    }

    heats.push({ heatId, heatName, status, roundNumber, heatNumber, athletes });
  }
  return heats;
}

// Translate a relative round label (QF/SF/Final) to an absolute round number
// given the total number of rounds in this bracket. Used as a fallback when
// the heat div didn't carry a data-round-number attribute (Bracket tab).
function inferRoundFromName(heatName, totalRounds) {
  let m = heatName.match(/^R(\d+)\s+Heat\s+(\d+)$/i);
  if (m) return { roundNumber: parseInt(m[1], 10), heatNumber: parseInt(m[2], 10) };
  m = heatName.match(/^QF\s+Heat\s+(\d+)$/i);
  if (m) return { roundNumber: totalRounds - 2, heatNumber: parseInt(m[1], 10) };
  m = heatName.match(/^SF\s+Heat\s+(\d+)$/i);
  if (m) return { roundNumber: totalRounds - 1, heatNumber: parseInt(m[1], 10) };
  if (/^Final$/i.test(heatName)) return { roundNumber: totalRounds, heatNumber: 1 };
  return { roundNumber: null, heatNumber: null };
}

// Full per-gender scrape: discover rounds, fetch each, merge, resolve round
// numbers, sort. Returns { heats, totalRounds }.
export async function scrapeEventForGender(event, season, log = () => {}) {
  log(`Scraping ${event.tour}: "${event.name}" (status: ${event.status})…`);
  const rounds = await discoverRounds(event, season, log);
  if (rounds.length === 0) {
    throw new Error(`No round tabs found for ${event.tour} at ${event.slug}`);
  }

  const allHeats = [];
  for (const r of rounds) {
    log(`  Fetching "${r.label}" (roundId=${r.roundId})…`);
    // Tab labels like "Round 1", "Round 2" give us an explicit round number
    // to fall back on for heats that don't carry their own. "Bracket" tabs
    // contain multiple rounds (R2..Final) and rely on per-heat names.
    const labelM = r.label.match(/^Round\s+(\d+)$/i);
    const defaultRoundNumber = labelM ? parseInt(labelM[1], 10) : null;
    const heats = await fetchRoundHeats(event, season, r.roundId, defaultRoundNumber);
    const completed = heats.filter((h) => h.status === "over").length;
    log(`    ${heats.length} heats parsed (${completed} completed).`);
    allHeats.push(...heats);
  }

  // Figure out the total round count to resolve QF/SF/Final into absolute
  // round numbers. Bracket structure: 1..(N-3) numeric, then QF, SF, F.
  const numericRounds = new Set();
  let hasQF = false, hasSF = false, hasFinal = false;
  for (const h of allHeats) {
    const m = h.heatName.match(/^R(\d+)/i);
    if (m) numericRounds.add(parseInt(m[1], 10));
    if (/^QF/i.test(h.heatName)) hasQF = true;
    if (/^SF/i.test(h.heatName)) hasSF = true;
    if (/^Final$/i.test(h.heatName)) hasFinal = true;
  }
  const maxNumeric = numericRounds.size ? Math.max(...numericRounds) : 0;
  const totalRounds = maxNumeric + (hasQF ? 1 : 0) + (hasSF ? 1 : 0) + (hasFinal ? 1 : 0);

  for (const h of allHeats) {
    if (h.roundNumber == null || h.heatNumber == null) {
      const inferred = inferRoundFromName(h.heatName, totalRounds);
      if (h.roundNumber == null) h.roundNumber = inferred.roundNumber;
      if (h.heatNumber == null) h.heatNumber = inferred.heatNumber;
    }
  }

  allHeats.sort(
    (a, b) => (a.roundNumber - b.roundNumber) || (a.heatNumber - b.heatNumber),
  );
  log(`  Total: ${allHeats.length} heats across ${totalRounds} rounds.`);
  return { heats: allHeats, totalRounds };
}
