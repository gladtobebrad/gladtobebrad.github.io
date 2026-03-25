import { auth, db } from "./firebase-config.js";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
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

function friendlyAuthError(code) {
  const map = {
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "No account found with that email.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Invalid email address.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return map[code] || "Sign-in failed. Please try again.";
}

// Sign in with email/password
export async function signInWithEmail(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(friendlyAuthError(err.code));
  }
}

// Register with email/password
export async function registerWithEmail(email, password, displayName) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
  } catch (err) {
    throw new Error(friendlyAuthError(err.code));
  }
}

// Send password reset email
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    throw new Error(friendlyAuthError(err.code));
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
      adsCoins: user.providerData.some(p => p.providerId === "google.com") ? 10 : 9,
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
