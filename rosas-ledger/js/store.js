import { isFirebaseConfigured, firebaseConfig, COLLECTION_TRIPS, DEFAULT_TOLERANCE } from "./config.js";
import { applyVariance, normalizeTrip, num } from "./core.js";
import { DEMO_SEED_VERSION, getDemoTrips } from "./demo-data.js";

const LS_TRIPS = "rosasLedger.trips";
const LS_SETTINGS = "rosasLedger.settings";
const LS_SESSION = "rosasLedger.session";
const LS_SEED = "rosasLedger.demoSeed";

let mode = "demo"; // 'demo' | 'firebase'
let trips = [];
let settings = { tolerance: DEFAULT_TOLERANCE };
let listeners = new Set();
let unsubFs = null;
let firebase = null; // { app, auth, db, mods }

function emit() {
  for (const fn of listeners) fn(getState());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return {
    mode,
    trips: trips.map((t) => applyVariance(t, settings.tolerance)),
    settings: { ...settings },
    session: readSession(),
    firebaseReady: Boolean(firebase)
  };
}

export function getTrips() {
  return getState().trips;
}

export function getSettings() {
  return { ...settings };
}

export function readSession() {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSION) || "null");
  } catch {
    return null;
  }
}

export function writeSession(session) {
  if (!session) localStorage.removeItem(LS_SESSION);
  else localStorage.setItem(LS_SESSION, JSON.stringify(session));
}

function loadLocalSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null");
    if (raw && typeof raw === "object") settings = { tolerance: DEFAULT_TOLERANCE, ...raw };
  } catch { /* keep defaults */ }
}

function saveLocalSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

function loadLocalTrips() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TRIPS) || "null");
    if (Array.isArray(raw) && raw.length) {
      trips = raw.map((t) => normalizeTrip(t, settings.tolerance));
      return;
    }
  } catch { /* seed */ }
  seedDemo();
}

function persistLocalTrips() {
  localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
}

export function seedDemo(force = false) {
  const ver = Number(localStorage.getItem(LS_SEED) || "0");
  if (!force && ver === DEMO_SEED_VERSION && trips.length) return;
  trips = getDemoTrips(settings.tolerance);
  persistLocalTrips();
  localStorage.setItem(LS_SEED, String(DEMO_SEED_VERSION));
  emit();
}

export async function initStore() {
  loadLocalSettings();
  const session = readSession();
  if (session?.mode === "firebase" && isFirebaseConfigured()) {
    try {
      await initFirebase();
      mode = "firebase";
      return;
    } catch (err) {
      console.warn("[Rosa] Firebase init failed, staying demo", err);
    }
  }
  mode = "demo";
  loadLocalTrips();
  if (!trips.length) seedDemo(true);
  emit();
}

export function enterDemo() {
  if (unsubFs) { unsubFs(); unsubFs = null; }
  mode = "demo";
  writeSession({ mode: "demo", email: "rosa@demo.ledger", author: "Rosa" });
  loadLocalTrips();
  if (!trips.length) seedDemo(true);
  emit();
}

export async function initFirebase() {
  if (firebase) return firebase;
  if (!isFirebaseConfigured()) throw new Error("Firebase is not configured");
  const appMod = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
  const fsMod = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  firebase = { app, auth, db, authMod, fsMod };
  return firebase;
}

export async function signIn(email, password) {
  const fb = await initFirebase();
  const cred = await fb.authMod.signInWithEmailAndPassword(fb.auth, email, password);
  mode = "firebase";
  writeSession({
    mode: "firebase",
    email: cred.user.email,
    uid: cred.user.uid,
    author: guessAuthor(cred.user.email)
  });
  await listenFirestore();
  emit();
  return cred.user;
}

function guessAuthor(email) {
  const e = (email || "").toLowerCase();
  if (e.includes("frank")) return "Frank";
  return "Rosa";
}

export function currentAuthor() {
  const s = readSession();
  return s?.author || "Rosa";
}

async function listenFirestore() {
  if (!firebase) return;
  if (unsubFs) unsubFs();
  const { fsMod, db } = firebase;
  const col = fsMod.collection(db, COLLECTION_TRIPS);
  unsubFs = fsMod.onSnapshot(col, (snap) => {
    trips = snap.docs.map((d) => normalizeTrip({ id: d.id, ...d.data() }, settings.tolerance));
    emit();
  }, (err) => {
    console.warn("[Rosa] Firestore listen failed", err);
  });
}

export async function signOutUser() {
  if (unsubFs) { unsubFs(); unsubFs = null; }
  if (firebase?.auth) {
    try { await firebase.authMod.signOut(firebase.auth); } catch { /* ignore */ }
  }
  writeSession(null);
  mode = "demo";
  trips = [];
  emit();
}

export async function saveTrip(next) {
  const t = normalizeTrip(next, settings.tolerance);
  const idx = trips.findIndex((x) => x.id === t.id);
  if (idx >= 0) trips = trips.map((x) => x.id === t.id ? t : x);
  else trips = [...trips, t];
  if (mode === "demo") persistLocalTrips();
  if (mode === "firebase" && firebase) {
    const { fsMod, db } = firebase;
    const { id, ...data } = t;
    await fsMod.setDoc(fsMod.doc(db, COLLECTION_TRIPS, id), data, { merge: true });
  }
  emit();
  return t;
}

export async function saveTolerance(value) {
  settings = { ...settings, tolerance: Math.max(0, num(value)) };
  saveLocalSettings();
  trips = trips.map((t) => applyVariance(t, settings.tolerance));
  if (mode === "demo") persistLocalTrips();
  emit();
}

export function resetDemoData() {
  seedDemo(true);
}

export { isFirebaseConfigured };
