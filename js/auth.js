import { auth, db } from "./firebase-config.js";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();

// undefined = not yet resolved, null = resolved but no user
let currentUser = undefined;
let currentUserProfile = null;
let authResolved = false;
const authCallbacks = [];

// Sign in with Google — popup first, redirect fallback for mobile/Safari
export async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/popup-cancelled-by-user") {
      // Browser blocked the popup — fall back to redirect
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectErr) {
        console.error("Sign-in redirect error:", redirectErr);
      }
    } else if (err.code !== "auth/popup-closed-by-user") {
      console.error("Sign-in error:", err);
    }
  }
}

// Sign out
export async function signOut() {
  await firebaseSignOut(auth);
  currentUser = null;
  currentUserProfile = null;
}

// Get current Firebase user
export function getCurrentUser() {
  return currentUser;
}

// Get current user's Firestore profile
export function getUserProfile() {
  return currentUserProfile;
}

// Register a callback for auth state changes
export function onAuth(callback) {
  authCallbacks.push(callback);
  // Only fire immediately if auth has already resolved
  if (authResolved) {
    callback(currentUser, currentUserProfile);
  }
}

// Create or update user profile doc on sign-in
async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    currentUserProfile = snap.data();
  } else {
    const profile = {
      displayName: user.displayName || "Anonymous",
      email: user.email || "",
      photoUrl: user.photoURL || "",
      isAdmin: false,
      joinedAt: serverTimestamp(),
      teamName: "",
      adsCoins: 10,
      clubId: null
    };
    await setDoc(ref, profile);
    currentUserProfile = { ...profile, joinedAt: new Date() };
  }
}

// Initialize auth listener — call once on page load
export function initAuth() {
  // Handle returning redirect (mobile fallback)
  getRedirectResult(auth).catch((err) => {
    if (err.code === "auth/missing-initial-state" || err.code === "auth/cancelled-popup-request") {
      // Safari/in-app browser killed the session state — show a helpful message
      // Insert message below whichever sign-in button is visible
      const btn = document.getElementById("btn-gate-signin") || document.getElementById("btn-signin");
      const msg = document.createElement("p");
      msg.style.cssText = "color:#b45309;font-size:0.85rem;margin-top:0.75rem;text-align:center;max-width:320px;margin-left:auto;margin-right:auto";
      msg.textContent = "Sign-in couldn't complete. Open this page in Safari or Chrome directly rather than from another app.";
      if (btn?.parentNode) btn.parentNode.insertBefore(msg, btn.nextSibling);
    } else {
      console.error("Redirect result error:", err);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      try {
        await ensureUserProfile(user);
      } catch (err) {
        console.error("Firestore profile error (is Firestore enabled?):", err);
        currentUserProfile = {
          displayName: user.displayName || "Anonymous",
          email: user.email || "",
          photoUrl: user.photoURL || "",
          isAdmin: false,
          teamName: ""
        };
      }
    } else {
      currentUser = null;
      currentUserProfile = null;
    }
    authResolved = true;
    authCallbacks.forEach((cb) => cb(currentUser, currentUserProfile));
  });
}

// Guard: redirect to index if not signed in
export function requireAuth() {
  return new Promise((resolve) => {
    onAuth((user) => {
      if (!user) {
        window.location.href = "index.html";
      } else {
        resolve(user);
      }
    });
  });
}

// Guard: redirect to index if not admin
// Re-fetches profile from Firestore to pick up isAdmin changes
export function requireAdmin() {
  return new Promise((resolve) => {
    onAuth(async (user) => {
      if (!user) {
        window.location.href = "index.html";
        return;
      }
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        const profile = snap.exists() ? snap.data() : null;
        if (!profile?.isAdmin) {
          window.location.href = "index.html";
        } else {
          currentUserProfile = profile;
          resolve(user);
        }
      } catch (err) {
        console.error("Admin check failed:", err);
        window.location.href = "index.html";
      }
    });
  });
}
