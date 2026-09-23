import { isFirebaseConfigured, firebaseConfig, COLLECTION_TRIPS, COLLECTION_WEEKLY, COLLECTION_BACKUPS, BACKUP_DOC, DEFAULT_TOLERANCE } from "./config.js?v=20260923a";
import { applyVariance, migrateTripDeductions, normalizeTrip, normalizeWeeklyTotals, num } from "./core.js?v=20260923a";
import { DEMO_SEED_VERSION, getDemoTrips, getDemoWeeklyTotals } from "./demo-data.js?v=20260923a";

const LS_TRIPS = "rosasLedger.trips";
const LS_WEEKS = "rosasLedger.weeklyTotals";
const LS_SETTINGS = "rosasLedger.settings";
const LS_SESSION = "rosasLedger.session";
const LS_SEED = "rosasLedger.demoSeed";
const LS_BACKUP = "rosasLedger.backup.preWeeklyTotals";

let mode = "demo"; // 'demo' | 'firebase'
let trips = [];
let weeklyTotals = [];
let settings = { tolerance: DEFAULT_TOLERANCE };
let listeners = new Set();
let unsubFs = null;
let unsubWeeks = null;
let firebase = null; // { app, auth, db, mods }
let listenError = "";
let migrating = false;
let listenReady = false;
/** Weeks written by migration, kept if a stale snapshot arrives before the write lands. */
const pinnedWeeks = new Map();
const LISTEN_FALLBACK_MS = 8000;

function applyFsDocs(docs) {
  if (migrating) return;
  trips = (docs || []).map((d) => normalizeTrip({ id: d.id, ...d.data() }, settings.tolerance));
}

function applyFsWeeks(docs) {
  if (migrating) return;
  const incoming = (docs || []).map((d) => normalizeWeeklyTotals({ payWeek: d.id, ...d.data() }));
  const map = new Map(incoming.map((w) => [w.payWeek, w]));
  for (const [id, w] of pinnedWeeks) {
    if (map.has(id)) pinnedWeeks.delete(id);
    else map.set(id, w);
  }
  weeklyTotals = [...map.values()];
}

function waitForAuthUser(fb) {
  if (fb.auth.currentUser) return Promise.resolve(fb.auth.currentUser);
  return new Promise((resolve) => {
    const unsub = fb.authMod.onAuthStateChanged(fb.auth, (user) => {
      unsub();
      resolve(user || null);
    });
  });
}

function enterFirebaseSession(user) {
  mode = "firebase";
  trips = [];
  listenError = "";
  writeSession({
    mode: "firebase",
    email: user.email,
    uid: user.uid,
    author: guessAuthor(user.email)
  });
}

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
    weeklyTotals: weeklyTotals.map((w) => normalizeWeeklyTotals(w)),
    settings: { ...settings },
    session: readSession(),
    firebaseReady: Boolean(firebase),
    listenError
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

function loadLocalWeeks() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_WEEKS) || "null");
    if (Array.isArray(raw)) {
      weeklyTotals = raw.map((w) => normalizeWeeklyTotals(w));
      return;
    }
  } catch { /* empty */ }
  weeklyTotals = [];
}

function persistLocalWeeks() {
  localStorage.setItem(LS_WEEKS, JSON.stringify(weeklyTotals));
}

function writeBackupOnce(backup) {
  if (!backup) return;
  try {
    if (!localStorage.getItem(LS_BACKUP)) {
      localStorage.setItem(LS_BACKUP, JSON.stringify(backup));
    }
  } catch (err) {
    err.backupFailed = true;
    throw err;
  }
}

export function readDeductionBackup() {
  try {
    return JSON.parse(localStorage.getItem(LS_BACKUP) || "null");
  } catch {
    return null;
  }
}

export function seedDemo(force = false) {
  const ver = Number(localStorage.getItem(LS_SEED) || "0");
  if (!force && ver === DEMO_SEED_VERSION && trips.length) return;
  trips = getDemoTrips(settings.tolerance);
  weeklyTotals = getDemoWeeklyTotals();
  persistLocalTrips();
  persistLocalWeeks();
  localStorage.setItem(LS_SEED, String(DEMO_SEED_VERSION));
  emit();
}

export async function initStore() {
  loadLocalSettings();
  const session = readSession();
  if (session?.mode === "firebase" && isFirebaseConfigured()) {
    try {
      const fb = await initFirebase();
      const user = await waitForAuthUser(fb);
      if (user) {
        enterFirebaseSession(user);
        await listenFirestore();
        return;
      }
      writeSession(null);
    } catch (err) {
      console.warn("[Rosa] Firebase init failed, staying demo", err);
    }
  }
  mode = "demo";
  loadLocalTrips();
  loadLocalWeeks();
  if (!trips.length) seedDemo(true);
  await applyMigrationIfNeeded();
  emit();
}

export async function enterDemo() {
  if (unsubFs) { unsubFs(); unsubFs = null; }
  if (unsubWeeks) { unsubWeeks(); unsubWeeks = null; }
  listenReady = false;
  pinnedWeeks.clear();
  listenError = "";
  mode = "demo";
  writeSession({ mode: "demo", email: "rosa@demo.ledger", author: "Rosa" });
  loadLocalTrips();
  loadLocalWeeks();
  if (!trips.length) seedDemo(true);
  await applyMigrationIfNeeded();
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
  const db = typeof fsMod.initializeFirestore === "function"
    ? fsMod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    : fsMod.getFirestore(app);
  firebase = { app, auth, db, authMod, fsMod };
  return firebase;
}

export async function signIn(email, password) {
  const fb = await initFirebase();
  const cred = await fb.authMod.signInWithEmailAndPassword(fb.auth, email, password);
  enterFirebaseSession(cred.user);
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

function listenCollection(col, apply, label) {
  const { fsMod } = firebase;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const loadOnce = () => fsMod.getDocs(col).then((snap) => {
      apply(snap.docs);
      emit();
    });
    const hang = setTimeout(() => {
      loadOnce().catch((err) => {
        console.warn("[Rosa] Firestore getDocs fallback failed", label, err);
        listenError = (err && err.message) || String(err);
        emit();
      }).finally(done);
    }, LISTEN_FALLBACK_MS);
    const unsub = fsMod.onSnapshot(col, (snap) => {
      clearTimeout(hang);
      apply(snap.docs);
      if (label === "trips") listenError = "";
      emit();
      if (listenReady && label === "trips" && !migrating) applyMigrationIfNeeded();
      done();
    }, (err) => {
      clearTimeout(hang);
      console.warn("[Rosa] Firestore listen failed", label, err);
      listenError = (err && err.message) || String(err);
      emit();
      loadOnce().catch((err2) => {
        console.warn("[Rosa] Firestore getDocs fallback failed", label, err2);
        if (!listenError) listenError = (err2 && err2.message) || String(err2);
        emit();
      }).finally(done);
    });
    if (label === "trips") unsubFs = unsub;
    else unsubWeeks = unsub;
  });
}

function listenFirestore() {
  if (!firebase) return Promise.resolve();
  if (unsubFs) { unsubFs(); unsubFs = null; }
  if (unsubWeeks) { unsubWeeks(); unsubWeeks = null; }
  listenError = "";
  const { fsMod, db } = firebase;
  const tripsCol = fsMod.collection(db, COLLECTION_TRIPS);
  const weeksCol = fsMod.collection(db, COLLECTION_WEEKLY);
  listenReady = false;
  return Promise.all([
    listenCollection(tripsCol, applyFsDocs, "trips"),
    listenCollection(weeksCol, applyFsWeeks, "weeklyTotals")
  ]).then(() => {
    listenReady = true;
    return applyMigrationIfNeeded();
  });
}

export async function signOutUser() {
  if (unsubFs) { unsubFs(); unsubFs = null; }
  if (unsubWeeks) { unsubWeeks(); unsubWeeks = null; }
  listenError = "";
  if (firebase?.auth) {
    try { await firebase.authMod.signOut(firebase.auth); } catch { /* ignore */ }
  }
  writeSession(null);
  mode = "demo";
  trips = [];
  weeklyTotals = [];
  listenReady = false;
  pinnedWeeks.clear();
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

export async function saveWeeklyTotals(next) {
  const w = normalizeWeeklyTotals({
    ...next,
    entered: true,
    updatedAt: next?.updatedAt || new Date().toISOString()
  });
  if (!w.payWeek) throw new Error("Weekly totals need a pay week");
  const idx = weeklyTotals.findIndex((x) => x.payWeek === w.payWeek);
  if (idx >= 0) weeklyTotals = weeklyTotals.map((x) => x.payWeek === w.payWeek ? w : x);
  else weeklyTotals = [...weeklyTotals, w];
  if (mode === "demo") persistLocalWeeks();
  if (mode === "firebase" && firebase) {
    const { fsMod, db } = firebase;
    const { payWeek, ...data } = w;
    await fsMod.setDoc(fsMod.doc(db, COLLECTION_WEEKLY, payWeek), { ...data, payWeek }, { merge: true });
  }
  emit();
  return w;
}

async function writeFirestoreBackup(backup) {
  if (!firebase || !backup) return;
  const { fsMod, db } = firebase;
  const ref = fsMod.doc(db, COLLECTION_BACKUPS, BACKUP_DOC);
  const existing = await fsMod.getDoc(ref);
  if (existing.exists()) return;
  await fsMod.setDoc(ref, backup);
}

function hadStoredDeductions(t) {
  if (!t) return false;
  return [t.deductFuel, t.deductInsurance, t.deductLease, t.deductTruckWash].some((v) => v != null && v !== "");
}

async function persistMigrated(nextTrips, nextWeeks, backup) {
  const touched = new Set((backup?.trips || []).filter(hadStoredDeductions).map((t) => t.id));
  const weeksToWrite = (nextWeeks || []).filter((w) => w && w.payWeek && w.tripDeductionsFolded);
  if (mode === "demo") {
    persistLocalWeeks();
    persistLocalTrips();
    return;
  }
  if (mode !== "firebase" || !firebase) return;
  const { fsMod, db } = firebase;
  for (const w of weeksToWrite) {
    const { payWeek, ...data } = w;
    await fsMod.setDoc(fsMod.doc(db, COLLECTION_WEEKLY, payWeek), { ...data, payWeek }, { merge: true });
    pinnedWeeks.set(payWeek, w);
  }
  for (const t of nextTrips) {
    if (!touched.has(t.id)) continue;
    const { id, ...data } = t;
    await fsMod.setDoc(fsMod.doc(db, COLLECTION_TRIPS, id), data, { merge: true });
  }
}

/**
 * Backup, then move per-trip fixed costs onto weekly totals.
 * Local backup is required before any field is cleared. A failed write
 * restores the in-memory trips so nothing is dropped.
 */
export async function applyMigrationIfNeeded() {
  if (migrating) return;
  const result = migrateTripDeductions(trips, weeklyTotals, new Date().toISOString());
  if (!result.changed) return;
  const previousTrips = trips;
  const previousWeeks = weeklyTotals;
  try {
    writeBackupOnce(result.backup);
    migrating = true;
    if (mode === "firebase") {
      try { await writeFirestoreBackup(result.backup); }
      catch (err) { console.warn("[Rosa] Firestore backup skipped", err); }
    }
    trips = result.trips.map((t) => normalizeTrip(t, settings.tolerance));
    weeklyTotals = result.weeklyTotals.map((w) => normalizeWeeklyTotals(w));
    await persistMigrated(trips, weeklyTotals, result.backup);
    emit();
  } catch (err) {
    console.warn("[Rosa] Weekly totals migration aborted", err);
    pinnedWeeks.clear();
    trips = previousTrips;
    weeklyTotals = previousWeeks;
    if (mode === "demo") {
      try { persistLocalTrips(); persistLocalWeeks(); } catch { /* keep the backup copy */ }
    }
    listenError = "Could not move old deductions onto weekly totals. Your trips were left as they were. " + ((err && err.message) || "");
    emit();
  } finally {
    migrating = false;
  }
}

/** Shared localStorage key Nickey reads (see nickey-rosa-baseline.js / docs/rosa-nickey-baseline.md). */
export function publishedBaseline() {
  try {
    if (typeof window !== "undefined" && window.NickeyRosaBaseline) {
      return window.NickeyRosaBaseline.read();
    }
    const raw = JSON.parse(localStorage.getItem("nickeyRosa.baseline") || "null");
    if (!raw || typeof raw !== "object") return { amount: null };
    if (raw.kind === "week") return { amount: null, kind: "", label: "" };
    return raw;
  } catch {
    return { amount: null };
  }
}

/** Current Baseline is this trip's line haul (actualPay) only. */
export function publishTripBaseline(trip) {
  if (!trip || trip.actualPay == null || trip.actualPay === "") return publishedBaseline();
  if (typeof window !== "undefined" && window.NickeyRosaBaseline) {
    return window.NickeyRosaBaseline.publishFromTrip(trip);
  }
  return publishedBaseline();
}

export function publishManualBaseline(input) {
  if (typeof window !== "undefined" && window.NickeyRosaBaseline) {
    return window.NickeyRosaBaseline.publishManual(input);
  }
  return publishedBaseline();
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
