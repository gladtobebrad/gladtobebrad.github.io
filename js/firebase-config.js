// Firebase SDK imports (v11 modular, from CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// Replace with your Firebase project config
// (Firebase API keys are safe to expose client-side — security is enforced by Firestore rules + Auth)
const firebaseConfig = {
  apiKey: "AIzaSyDL4eGekrUTqvYrKXtznEQps86hRnL1G4A",
  authDomain: "FantasySurfer.firebaseapp.com",
  projectId: "fantasysurfer",
  storageBucket: "fantasysurfer.appspot.com",
  messagingSenderId: "G-CEY04638EW",
  appId: "1:856596619567:web:6246d8549a27e56de181da"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
