/**
 * Rosa's Ledger — live Firebase web config for project rosa-s-ledger.
 *
 * Keys are live (Email/Password auth, not Google OAuth). Demo mode remains
 * available from the login screen. See README.md.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBdQI88hmhev1YDa2DFKw-cuAZBQmOtC4I",
  authDomain: "rosa-s-ledger.firebaseapp.com",
  projectId: "rosa-s-ledger",
  storageBucket: "rosa-s-ledger.firebasestorage.app",
  messagingSenderId: "807399140103",
  appId: "1:807399140103:web:d629847288aeb3cbac73a2",
  measurementId: "G-L1G739S6ZC"
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
