# Firebase Deploy Hand-off — Wave 0 Security

> **For whoever administers the `fantasysurfer` Firebase project.**
> The app code in this repo has been hardened, and the security rules are now
> authored and version-controlled here. This doc is the deploy checklist for the
> parts that require Firebase Console / CLI access. Nothing here changes the
> static site — it only enforces server-side authorization.

---

## ✅ Status — updated 2026-06-18

- **Step 1 — Deploy the rules: DONE & verified live.** `firestore.rules` + `storage.rules` are deployed on project `fantasysurfer` and confirmed **byte-identical to this repo** (`firebase deploy` reported both rulesets "already up to date"). **The critical server-side-authorization gap is now closed.**
- **Step 2 — Custom-claims admin:** optional; **recommend deferring** — self-elevation is already closed by the `isAdmin`-immutable rule.
- **Step 3 — Restrict the web API key:** **delegated to the GCP project admin (2026-06-18).** Requires Cloud-Console **IAM** access — *Firebase* "Editor" access is **not** sufficient (Firebase editors hit `resourcemanager.projects.get (Missing)` and can't open Credentials). Instructions inlined in Step 3 below.
- **Step 4 — App Check:** optional; deferred until monetization (needs a client snippet — ping me).

## Why this matters (one paragraph)

Until these rules are deployed, **every integrity rule lives only in the browser
and is bypassable from the dev console**: a signed-in user can set their own
`users/{uid}.isAdmin = true`, overwrite `surfers`/`events`/`results`/
`leaderboard`, or submit a winning roster *after* an event's results are public.
The client checks are good but unenforceable without these rules. This is the
one blocker before the site can safely take money/ads.

## What already changed in the repo (no Firebase access needed — already done)

- **`firestore.rules`**, **`storage.rules`**, **`firebase.json`**,
  **`firestore.indexes.json`**, **`.firebaserc`** — authored from the actual
  data model in `js/db.js` / `js/auth.js`.
- **Client XSS hardening** — `escapeHtml()` + `safeUrl()` added to `js/ui.js`
  and applied at every `innerHTML` sink that renders user/remote data
  (team/display names, club names, avatar/photo URLs, scraped WSL status/surfer/
  venue strings). Avatar URLs are validated to `http(s)` on save. Unit-tested in
  `test/security-helpers.test.mjs` (`node test/security-helpers.test.mjs`).

## What YOU need to do (requires Firebase access)

### 1. Deploy the rules  ← ✅ DONE (2026-06-18)

**Completed 2026-06-18** via `firebase deploy --only firestore:rules,storage` — both rulesets compiled, released, and verified identical to the repo. Commands retained below for reference / re-deploy.

```bash
# one-time, on your machine:
npm install -g firebase-tools
firebase login                       # use the account that owns project "fantasysurfer"

# from the repo root:
firebase deploy --only firestore:rules,storage
```
`firebase deploy` compiles the rules and will report any syntax error before
publishing. (`.firebaserc` already points at project `fantasysurfer`.)

> Prefer to review in the UI first? Paste `firestore.rules` into
> **Firebase Console → Firestore → Rules** and use **"Simulate"** /
> the Rules Playground, then **Publish**. Same for `storage.rules` under Storage.

### 2. (Recommended) Move admin to custom claims
The rules already make `users.isAdmin` immutable from the client, so
self-elevation is closed. For defense-in-depth, grant admin via a **custom auth
claim** instead of a Firestore field (then `isAdmin()` in the rules can read
`request.auth.token.admin`). One-time, with the Admin SDK / Cloud Shell:
```js
// admin.auth().setCustomUserClaims(uid, { admin: true })
```
Optional — not required for Wave 0. If you skip it, the `isAdmin`-immutable rule
is the safeguard; set the initial admin's `users/{uid}.isAdmin` to `true`
manually in the Console once.

> **2026-06-18 — recommend deferring indefinitely.** The `isAdmin`-immutable rule
> already closes self-elevation (the real threat); custom claims is a multi-part
> migration (Admin-SDK service-account key + rules + client changes + token
> refresh) for marginal defense-in-depth. Revisit only with a concrete reason.

### 3. (Recommended) Restrict the web API key  ← delegated to GCP admin (2026-06-18)

> **Access note:** this is a **Google Cloud Console** task requiring a **GCP IAM
> role** (`API Keys Admin` + `Browser`, or Editor/Owner). *Firebase* "Editor"
> access is **not** enough — a Firebase editor gets `resourcemanager.projects.get
> (Missing)` and can't open Credentials. As of 2026-06-18 this is handed to the
> project's GCP admin/Owner (instructions shared).

**Google Cloud Console → APIs & Services → Credentials → the Browser key** →
**Application restrictions → HTTP referrers (web sites)** → add
`https://gladtobebrad.github.io/*` and `https://*.firebaseapp.com/*` → **Save**.
The key in `js/firebase-config.js` is safe to expose; referrer-locking just blunts
scripted abuse of the key/quota and does **not** affect the deployed rules. After
saving, load `gladtobebrad.github.io` in incognito and confirm sign-in + reads
still work. (Local dev over `localhost` won't match these referrers — add
`http://localhost:8000/*` if you test locally, or test against the live site.)

### 4. (Optional, for monetization) Enable App Check
Register the site with **App Check** (reCAPTCHA v3 provider) and enforce it on
Firestore + Storage. This stops non-browser clients from hitting your data even
when signed in. Requires a small client snippet in `firebase-config.js` — ping
me and I'll add it once you've registered the site key.

> **2026-06-18 — deferred until monetization.** Rollout discipline when you do it:
> register the reCAPTCHA v3 key + App Check, add the client snippet, run in
> **monitor** mode first to confirm real traffic sends valid tokens, *then* flip
> to **enforce** — enforcing before the client sends tokens locks the app out.

## Pre-deploy review checklist (for the reviewer)

- [ ] Confirm the initial admin account's `users/{uid}.isAdmin` is `true`
      (otherwise the admin panel locks everyone out after deploy).
- [ ] Confirm the Storage bucket avatars path matches `avatars/{uid}` (it does in
      `openProfileEditModal`).
- [ ] Read the **KNOWN LIMITATIONS** block at the top of `firestore.rules`:
      cap/roster invariants are not yet validated server-side (the trading-open
      gate is the integrity-critical control); club membership writes are coarse;
      `adsCoins` is currently signup-only.

## Verifying after deploy

- Sign in as a **non-admin** and confirm: you can save your own team while
  trading is open; you **cannot** save it once trading closes; you **cannot**
  write to another user's team or to `surfers`/`events`.
- Confirm a non-admin **cannot** set their own `isAdmin` to `true` (try it from
  the console — it should be denied).
- Confirm the admin panel still loads and can write events/surfers/results.

## Rollback

Rules are versioned in the Firebase Console (Firestore → Rules → history). If a
deploy breaks something, **Rollback** to the previous ruleset there, then tell me
what was denied so I can adjust `firestore.rules` in the repo.
