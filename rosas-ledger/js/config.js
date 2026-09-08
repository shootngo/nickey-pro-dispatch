/**
 * Rosa's Ledger — Firebase placeholders.
 *
 * Frank: paste values from the Google Cloud / Firebase project that already
 * serves Nickey. Enable Email/Password auth (not Google OAuth) and create
 * two users (frank@… and rosa@…). See README.md.
 *
 * Leave the YOUR_ sentinels in place to keep the app in demo/offline mode.
 */
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

export const COLLECTION_TRIPS = "trips";
export const COLLECTION_SETTINGS = "settings";
export const SETTINGS_DOC = "rosa";

export const DEFAULT_TOLERANCE = 25;

export function isFirebaseConfigured() {
  const key = firebaseConfig.apiKey || "";
  const project = firebaseConfig.projectId || "";
  return Boolean(key) && !key.startsWith("YOUR_") && Boolean(project) && !project.startsWith("YOUR_");
}
