import {
  addDays, actualTotal, applyVariance, downloadBlob,
  estTotal, exportRows, findWeeklyTotals, formatLongDate, formatWeekRange, hasActuals, isFlagged,
  lane, money, monthLabel, num, parseISODate, payWeekDays,
  pnlForYear, prefillWeeklyDraft, shortMonth, startOfPayWeek, toCsv, toISODate, todayISO,
  tripsInMonth, tripsInWeek, tripsInYear, tripsOnDay, varianceOf, weekdayShort, weeklyExportRows,
  weeklyFieldEdited, weeklyTotalsInYear, weekPaySheet, weekRunningTotal, weekShade
} from "./core.js?v=20260923a";
import { buildXlsx } from "./xlsx-lite.js?v=20260923a";
import { ROSA_APP_VERSION } from "./config.js?v=20260923e";
import {
  currentAuthor, enterDemo, getSettings, getState, initStore, isFirebaseConfigured,
  publishedBaseline, publishTripBaseline,
  readSession, resetDemoData, saveTolerance, saveTrip, saveWeeklyTotals, signIn, signOutUser, subscribe
} from "./store.js?v=20260923c";

const appEl = document.getElementById("app");
const toastEl = document.getElementById("toast");

const ui = {
  screen: "splash",
  calMode: "month",
  cursor: new Date(),
  selectedDay: todayISO(),
  weekSunday: startOfPayWeek(todayISO()),
  tripId: null,
  draft: null,
  olderCount: 10,
  loginError: "",
  loginBusy: false,
  modal: null,
  pnlYear: new Date().getFullYear(),
  exporting: false,
  totalsDraft: null
};

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function icon(name) {
  const icons = {
    back: '<polyline points="15 18 9 12 15 6"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    week: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;
}

function go(hash) {
  toastEl.classList.remove("show");
  location.hash = hash;
}

function parseHash() {
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  return parts;
}

function applyHash() {
  const session = readSession();
  const parts = parseHash();
  const top = parts[0] || "";
  if (ui.screen === "splash") return;
  if (!session && top !== "login") {
    ui.screen = "login";
    render();
    return;
  }
  if (!top || top === "calendar") {
    ui.screen = "calendar";
    if (parts[1] === "year" && parts[2]) {
      ui.calMode = "year";
      ui.cursor = new Date(Number(parts[2]), ui.cursor.getMonth(), 1);
    } else if (parts[1] && parts[2]) {
      ui.calMode = "month";
      ui.cursor = new Date(Number(parts[1]), Number(parts[2]) - 1, 1);
    }
    render();
    return;
  }
  if (top === "login") { ui.screen = "login"; render(); return; }
  if (top === "day" && parts[1]) {
    ui.screen = "calendar";
    ui.calMode = "day";
    ui.selectedDay = parts[1];
    ui.weekSunday = startOfPayWeek(parts[1]);
    const d = parseISODate(parts[1]);
    if (d) ui.cursor = d;
    render();
    return;
  }
  if (top === "week" && parts[1]) {
    ui.screen = "week";
    ui.weekSunday = startOfPayWeek(parts[1]) || parts[1];
    ui.selectedDay = parts[2] || ui.weekSunday;
    render();
    return;
  }
  if (top === "totals" && parts[1]) {
    ui.screen = "totals";
    const sunday = startOfPayWeek(parts[1]) || parts[1];
    if (ui.weekSunday !== sunday) ui.totalsDraft = null;
    ui.weekSunday = sunday;
    render();
    return;
  }
  if (top === "trip" && parts[1]) {
    ui.screen = "trip";
    if (ui.tripId !== parts[1]) {
      ui.tripId = parts[1];
      ui.draft = null;
    }
    render();
    return;
  }
  if (top === "pnl") {
    ui.screen = "pnl";
    if (parts[1]) ui.pnlYear = Number(parts[1]) || ui.pnlYear;
    render();
    return;
  }
  if (top === "settings") { ui.screen = "settings"; render(); return; }
  ui.screen = "calendar";
  render();
}

window.addEventListener("hashchange", applyHash);

function header(title, sub, { back, right } = {}) {
  return `<header class="hdr">
    ${back ? `<button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button>` : ""}
    <h1>${esc(title)}${sub ? `<span class="subline">${esc(sub)}</span>` : ""}</h1>
    ${right || ""}
  </header>`;
}

function nav(active) {
  const item = (id, label, ic, href) =>
    `<button class="${active === id ? "on" : ""}" data-act="nav" data-href="${href}">${icon(ic)}<span>${label}</span></button>`;
  const weekHref = `#/week/${startOfPayWeek(ui.selectedDay || todayISO())}/${ui.selectedDay || todayISO()}`;
  return `<nav class="nav">
    ${item("calendar", "Calendar", "cal", "#/calendar")}
    ${item("week", "Week", "week", weekHref)}
    ${item("pnl", "P&amp;L", "chart", `#/pnl/${ui.pnlYear}`)}
    ${item("settings", "More", "more", "#/settings")}
  </nav>`;
}

function modePill() {
  const s = getState();
  if (s.mode === "demo") return `<span class="demo-pill">Demo</span>`;
  return `<span class="live-pill">Live</span>`;
}

function baselineApi() {
  return (typeof window !== "undefined" && window.NickeyRosaBaseline) || null;
}

function baselineCard({ compact } = {}) {
  const rec = publishedBaseline();
  const api = baselineApi();
  const legacyWeek = !!(rec && rec.kind === "week");
  const has = !!(rec && rec.amount != null && !legacyWeek);
  const amt = has ? (api ? api.formatMoney(rec.amount) : money(rec.amount)) : "—";
  const sub = has
    ? `${esc(rec.label || "Line haul")}${rec.savedAt ? " · sent to Nickey" : ""}`
    : "Waiting on a trip line haul.";
  const legacyWeekHint = legacyWeek
    ? `<p class="hint">Week totals stay on the pay sheet. Nickey baseline is one trip's line haul.</p>`
    : "";
  return `<div class="baseline-card${compact ? " compact" : ""}">
    <div class="k">Nickey baseline · line haul</div>
    <div class="v tabular">${amt}</div>
    <div class="sub">${sub}</div>
    ${legacyWeekHint}
  </div>`;
}

function listenBanner() {
  const err = getState().listenError;
  if (!err) return "";
  return `<p class="error listen-banner">Could not load live trips: ${esc(err)}. Confirm Firestore rules allow signed-in read on collection <code>trips</code>, then sign in again.</p>`;
}

function renderSplash() {
  return `<section class="splash">
    <div class="splash-mark"><img src="./assets/icon.jpg" alt="Rosa's Ledger rose and eighteen-wheeler"></div>
    <h1>Rosa's Ledger<span>Pay verification</span></h1>
    <p class="tag">${esc(ROSA_APP_VERSION)} · Sun–Sat pay weeks · weekly deductions</p>
    <div class="splash-dots" aria-hidden="true"><i></i><i></i><i></i></div>
  </section>`;
}

function renderLogin() {
  const configured = isFirebaseConfigured();
  return `<section class="splash">
    <div class="splash-mark"><img src="./assets/icon.jpg" alt=""></div>
    <h1>Rosa's Ledger<span>Pay verification</span></h1>
    <form class="login-card" data-act="login">
      <h2>Sign in</h2>
      <p class="sub">Shared email / password — not Google. ${configured ? "Firebase is configured." : "Firebase placeholders are still in js/config.js."}</p>
      <div class="fld"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" ${configured ? "required" : ""}></div>
      <div class="fld"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" ${configured ? "required" : ""}></div>
      ${ui.loginError ? `<p class="error">${esc(ui.loginError)}</p>` : ""}
      <button class="btn btn-primary" type="submit" ${configured && !ui.loginBusy ? "" : "disabled"}>${ui.loginBusy ? "Loading trips…" : "Sign in"}</button>
      <div style="height:8px"></div>
      <button class="btn btn-gold" type="button" data-act="demo">Continue in demo mode</button>
      <p class="hint">Demo loads sample trips only — Nickey "Push to Rosa" jobs will not appear until you Sign in.</p>
    </form>
  </section>`;
}

function pendingWeekSet(trips, weeklyTotals) {
  const set = new Set();
  const sundays = new Set((trips || []).map((t) => t.payWeek || startOfPayWeek(t.tripDate)).filter(Boolean));
  for (const sunday of sundays) {
    if (weekPaySheet(trips, weeklyTotals, sunday).pending) set.add(sunday);
  }
  return set;
}

function monthGrid(year, monthIndex, trips, pendingWeeks) {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = todayISO();
  let html = `<div class="dow">${["S","M","T","W","T","F","S"].map((d) => `<span>${d}</span>`).join("")}</div><div class="grid">`;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISODate(d);
    const sunday = startOfPayWeek(iso);
    const onMonth = d.getMonth() === monthIndex;
    const dayTrips = tripsOnDay(trips, iso);
    const flagged = dayTrips.some((t) => t.flagged);
    const pending = pendingWeeks && pendingWeeks.has(sunday);
    const cls = [
      "cell",
      onMonth ? "" : "out",
      weekShade(sunday) ? "shade-b" : "shade-a",
      dayTrips.length ? "has" : "",
      flagged ? "flagged" : "",
      pending ? "pending" : "",
      iso === today ? "today" : "",
      iso === ui.selectedDay ? "selected" : ""
    ].filter(Boolean).join(" ");
    html += `<button type="button" class="${cls}" data-act="open-day" data-day="${iso}" aria-label="${iso}${dayTrips.length ? `, ${dayTrips.length} trip(s)` : ""}${flagged ? ", flagged" : ""}${pending ? ", pending deductions" : ""}">
      <span class="n">${d.getDate()}</span>
      <span class="marks">${dayTrips.length ? '<i class="dot"></i>' : ""}${pending ? '<i class="pend-pip"></i>' : ""}${flagged ? '<i class="flag-pip"></i>' : ""}</span>
    </button>`;
  }
  html += "</div>";
  return html;
}

function renderCalendar() {
  const { trips, weeklyTotals, settings } = getState();
  const y = ui.cursor.getFullYear();
  const m = ui.cursor.getMonth();
  const sunday = startOfPayWeek(ui.selectedDay);
  const run = weekRunningTotal(trips, sunday);
  const displayTotal = run.running;
  const pendingWeeks = pendingWeekSet(trips, weeklyTotals);
  const weekPending = pendingWeeks.has(sunday);
  const switcher = `<div class="view-switch">
    <button class="${ui.calMode === "month" ? "on" : ""}" data-act="cal-mode" data-mode="month">Month</button>
    <button class="${ui.calMode === "year" ? "on" : ""}" data-act="cal-mode" data-mode="year">Year</button>
    <button class="${ui.calMode === "day" ? "on" : ""}" data-act="cal-mode" data-mode="day">Day</button>
  </div>`;

  let body = "";
  if (ui.calMode === "year") {
    const pnl = pnlForYear(trips, y, weeklyTotals);
    body = `<div class="period-nav">
      <button class="icon-btn" data-act="shift-year" data-dir="-1" aria-label="Previous year">${icon("back")}</button>
      <div class="label"><div class="main">${y}</div><div class="sub">Sun–Sat pay weeks · band ${money(settings.tolerance)}</div></div>
      <button class="icon-btn" data-act="shift-year" data-dir="1" aria-label="Next year" style="transform:scaleX(-1)">${icon("back")}</button>
    </div>
    <div class="year-grid">${pnl.months.map((row, i) => {
      const monthTrips = tripsInMonth(trips, y, i);
      const monthPending = monthTrips.some((t) => pendingWeeks.has(t.payWeek || startOfPayWeek(t.tripDate)));
      const cls = ["month-card", i === new Date().getMonth() && y === new Date().getFullYear() ? "on" : "", row.flagged ? "flagged" : "", monthPending ? "pending" : ""].filter(Boolean).join(" ");
      return `<button class="${cls}" data-act="open-month" data-year="${y}" data-month="${i+1}">
        <div class="mn">${shortMonth(y, i)}</div>
        <div class="st">${row.trips} trip${row.trips === 1 ? "" : "s"}</div>
        <div class="pay">${monthTrips.length ? money(row.moneyIn || row.estIn) : "—"}</div>
      </button>`;
    }).join("")}</div>`;
  } else if (ui.calMode === "day") {
    const d = parseISODate(ui.selectedDay);
    const list = tripsOnDay(trips, ui.selectedDay);
    body = `<div class="period-nav">
      <button class="icon-btn" data-act="shift-day" data-dir="-1" aria-label="Previous day">${icon("back")}</button>
      <div class="label"><div class="main">${d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ui.selectedDay}</div><div class="sub">Pay week ${formatWeekRange(sunday)}</div></div>
      <button class="icon-btn" data-act="shift-day" data-dir="1" aria-label="Next day" style="transform:scaleX(-1)">${icon("back")}</button>
    </div>
    <div class="day-hero">
      <span class="dow-l">${weekdayShort(ui.selectedDay)}</span>
      <div class="big">${d ? d.getDate() : ""}</div>
      <div class="my">${d ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : ""}</div>
    </div>
    ${weekPending ? `<div class="pending-banner">Pending deductions.</div>` : ""}
    <div>${list.length ? list.map(tripRow).join("") : `<p class="empty" style="padding:18px 16px">No trips this day.</p>`}</div>
    <div style="padding:8px 14px 20px"><button class="btn btn-ghost" data-act="open-week" data-sunday="${sunday}" data-day="${ui.selectedDay}">Open full pay week</button></div>`;
  } else {
    body = `<div class="period-nav">
      <button class="icon-btn" data-act="shift-month" data-dir="-1" aria-label="Previous month">${icon("back")}</button>
      <div class="label"><div class="main">${monthLabel(y, m)}</div><div class="sub">Sun–Sat weeks · alt shading</div></div>
      <button class="icon-btn" data-act="shift-month" data-dir="1" aria-label="Next month" style="transform:scaleX(-1)">${icon("back")}</button>
    </div>
    <div class="cal">${monthGrid(y, m, trips, pendingWeeks)}</div>
    <div class="legend">
      <span><i class="dot"></i> Trip day</span>
      <span><i class="pend-pip"></i> Pending deductions</span>
      <span><i class="flag-pip"></i> Flagged (&gt; ${money(settings.tolerance)})</span>
      <span>Shaded = pay week</span>
    </div>
    <button class="week-summary" data-act="open-week" data-sunday="${sunday}" data-day="${ui.selectedDay}">
      <div class="k">Pay week ${esc(formatWeekRange(sunday))}${weekPending ? " · Pending deductions" : ""}</div>
      <div class="v tabular">${money(displayTotal)}</div>
      <div class="meta">${run.tripCount} trip${run.tripCount === 1 ? "" : "s"} · ${run.actualCount === run.tripCount && run.tripCount ? "all actuals" : run.actualCount ? run.actualCount + " booked, rest estimated" : "estimates"} · tap a day for the whole week</div>
    </button>`;
  }

  return `<div class="app-shell">
    ${header("Rosa's Ledger", ROSA_APP_VERSION, { right: modePill() })}
    ${switcher}
    ${listenBanner()}
    ${baselineCard({ compact: true })}
    ${body}
    ${nav("calendar")}
  </div>`;
}

function tripRow(t) {
  const ln = lane(t);
  const actual = actualTotal(t);
  const wait = !hasActuals(t);
  const bad = t.flagged;
  const actClass = wait ? "wait" : bad ? "bad" : "ok";
  const badge = bad ? '<span class="badge flag">Flag</span>' : wait ? '<span class="badge wait">Open</span>' : "";
  return `<button class="trip-row" data-act="open-trip" data-id="${esc(t.id)}">
    <div class="lane">
      <div class="who">${esc(ln.parties || t.id)} ${badge}</div>
      <div class="cities">${esc(ln.cities || formatLongDate(t.tripDate))}${t.pickup ? ` · #${esc(t.pickup)}` : ""}</div>
    </div>
    <div class="amt">
      <div class="est">Est ${money(estTotal(t))}</div>
      <div class="act ${actClass}">${wait ? "Enter actuals" : money(actual)}</div>
    </div>
  </button>`;
}

function weekMathBlock(sheet) {
  if (sheet.pending) {
    return `<section class="week-math pending">
      <div class="row gross"><span>Week gross</span><b class="tabular">${money(sheet.gross)}</b></div>
      <div class="pending-flag">Pending deductions.</div>
      <p class="hint">Week gross only until weekly totals are entered. Not Nickey's baseline.</p>
    </section>`;
  }
  if (!sheet.tripCount && !sheet.entered) {
    return `<section class="week-math">
      <div class="row gross"><span>Week gross</span><b class="tabular">—</b></div>
      <p class="hint">No trips this week. You can still enter weekly totals.</p>
    </section>`;
  }
  return `<section class="week-math">
    <div class="row gross"><span>Week gross</span><b class="tabular">${money(sheet.gross)}</b></div>
    <div class="row deduct"><span>Deductions</span><b class="tabular">${money(sheet.deductions)}</b></div>
    <div class="row net"><span>Net</span><b class="tabular">${money(sheet.net)}</b></div>
    <p class="hint">Pay sheet only. Not Nickey's baseline.</p>
  </section>`;
}

function renderWeek() {
  const { trips, weeklyTotals } = getState();
  const sunday = ui.weekSunday || startOfPayWeek(ui.selectedDay);
  const days = payWeekDays(sunday);
  const run = weekRunningTotal(trips, sunday);
  const sheet = weekPaySheet(trips, weeklyTotals, sunday);
  const older = [];
  let cursor = addDays(sunday, -7);
  for (let i = 0; i < ui.olderCount; i++) {
    older.push(cursor);
    cursor = addDays(cursor, -7);
  }
  const status = sheet.pending
    ? "Pending deductions"
    : (run.actualCount === run.tripCount && run.tripCount ? "actuals" : run.actualCount ? "mixed actuals + estimates" : "estimated");
  return `<div class="app-shell">
    ${header("Pay week", formatWeekRange(sunday), { back: true, right: modePill() })}
    ${listenBanner()}
    <div class="week-head">
      <div class="k">${sheet.pending ? "Pay week · pending deductions" : "Pay week"}</div>
      <div class="range">${esc(formatWeekRange(sunday))}</div>
      <div class="tot tabular">${run.tripCount} trip${run.tripCount === 1 ? "" : "s"} · ${esc(status)}</div>
    </div>
    ${baselineCard({ compact: true })}
    <p class="week-sheet-note">This number is the latest trip line haul saved. Week gross stays on this pay sheet.</p>
    ${days.map((iso) => {
      const list = tripsOnDay(trips, iso);
      const hi = iso === ui.selectedDay ? " hi" : "";
      const d = parseISODate(iso);
      return `<section class="day-block${hi}" id="day-${iso}">
        <div class="dh"><span class="num">${d ? d.getDate() : ""}</span> ${weekdayShort(iso)}</div>
        ${list.length ? list.map(tripRow).join("") : `<div class="empty">No trips</div>`}
      </section>`;
    }).join("")}
    ${weekMathBlock(sheet)}
    <div class="totals-cta">
      <button class="btn btn-gold" type="button" data-act="open-totals" data-sunday="${sunday}">Enter Weekly Totals</button>
    </div>
    <div class="older">
      <h3>Older weeks</h3>
      ${older.map((sun) => {
        const olderSheet = weekPaySheet(trips, weeklyTotals, sun);
        const flag = !olderSheet.pending && tripsInWeek(trips, sun).some((t) => t.flagged);
        const meta = olderSheet.pending
          ? `${olderSheet.tripCount} trip${olderSheet.tripCount === 1 ? "" : "s"} · Pending deductions`
          : `${olderSheet.tripCount} trip${olderSheet.tripCount === 1 ? "" : "s"}${flag ? " · flagged" : ""}${olderSheet.entered ? " · net" : ""}`;
        const amt = !olderSheet.tripCount && !olderSheet.entered
          ? "—"
          : olderSheet.pending
            ? money(olderSheet.gross)
            : olderSheet.entered
              ? money(olderSheet.net)
              : money(olderSheet.gross);
        return `<button class="week-card${olderSheet.pending ? " pending" : ""}" data-act="open-week" data-sunday="${sun}" data-day="${sun}">
          <div><div class="r">${esc(formatWeekRange(sun))}</div><div class="m">${meta}</div></div>
          <div class="tabular">${amt}</div>
        </button>`;
      }).join("")}
      <button class="btn btn-ghost" data-act="more-weeks">Scroll older weeks</button>
    </div>
    ${nav("week")}
  </div>`;
}

function moneyField(id, label, value, extraClass = "", chip = "") {
  const v = value == null || value === "" ? "" : String(value);
  return `<div class="fld money-fld ${extraClass}">
    <label for="${id}">${esc(label)}${chip}</label>
    <span class="pre">$</span>
    <input id="${id}" name="${id}" inputmode="decimal" type="number" step="0.01" value="${esc(v)}">
  </div>`;
}

function ensureDraft(trip) {
  if (ui.draft && ui.draft.id === trip.id) return ui.draft;
  ui.draft = {
    id: trip.id,
    actualPay: trip.actualPay,
    actualDetention: trip.actualDetention,
    actualExtra: trip.actualExtra,
    actualReefer: trip.actualReefer,
    noteText: ""
  };
  return ui.draft;
}

function draftAsTrip(trip) {
  const d = ui.draft;
  const next = {
    ...trip,
    actualPay: d.actualPay === "" || d.actualPay == null ? null : num(d.actualPay),
    actualDetention: d.actualDetention === "" || d.actualDetention == null ? null : num(d.actualDetention),
    actualExtra: d.actualExtra === "" || d.actualExtra == null ? null : num(d.actualExtra),
    actualReefer: d.actualReefer === "" || d.actualReefer == null ? null : num(d.actualReefer)
  };
  return applyVariance(next, getSettings().tolerance);
}

function renderTrip() {
  const { trips, settings } = getState();
  const trip = trips.find((t) => t.id === ui.tripId);
  if (!trip) {
    return `<div class="app-shell no-nav">${header("Missing trip", "", { back: true })}<p class="empty">That trip is not on the ledger.</p></div>`;
  }
  const draft = ensureDraft(trip);
  const live = draftAsTrip(trip);
  const ln = lane(trip);
  const v = varianceOf(live);
  const flagged = isFlagged(live, settings.tolerance);
  const wait = !hasActuals(live);
  const varClass = wait ? "wait" : flagged ? "bad" : "ok";
  const varLabel = wait ? "Waiting on actuals" : flagged ? "Flagged — outside band" : "Within tolerance";
  const city = ln.cities || trip.destCity || trip.originCity || "—";

  return `<div class="app-shell no-nav">
    ${header(trip.shipper || "Trip", formatLongDate(trip.tripDate), { back: true })}
    <div class="trip">
      <div class="trip-hero">
        <div class="lane">${esc(trip.shipper || ln.parties || trip.id)}</div>
        <div class="cities">${esc(city)}</div>
        <div class="meta">
          <span>${esc(formatLongDate(trip.tripDate))}</span>
          <span>Pay week ${esc(formatWeekRange(trip.payWeek))}</span>
        </div>
      </div>
      <div class="sec-title">This trip</div>
      <div class="est-grid">
        <div class="kv"><div class="k">Date</div><div class="v">${esc(formatLongDate(trip.tripDate))}</div></div>
        <div class="kv"><div class="k">Shipper</div><div class="v">${esc(trip.shipper || "—")}</div></div>
        <div class="kv"><div class="k">City</div><div class="v">${esc(city)}</div></div>
        <div class="kv"><div class="k">Consignee</div><div class="v">${esc(trip.consignee || "—")}</div></div>
      </div>
      <div class="sec-title">Frank's estimate</div>
      <div class="est-grid">
        <div class="kv"><div class="k">Linehaul</div><div class="v">${money(trip.estLinehaul)}</div></div>
        <div class="kv"><div class="k">Detention</div><div class="v">${money(trip.estDetention)}</div></div>
        <div class="kv"><div class="k">Extra pay</div><div class="v">${money(trip.estExtraPay)}</div></div>
        <div class="kv"><div class="k">Reefer fuel</div><div class="v">${money(trip.estReeferFuel)}</div></div>
      </div>
      <div class="est-grid" style="margin-top:8px">
        <div class="kv"><div class="k">Est total</div><div class="v">${money(estTotal(trip))}</div></div>
        <div class="kv"><div class="k">Miles</div><div class="v">${trip.miles || "—"}</div></div>
      </div>
      <div class="sec-title">Line haul</div>
      <p class="hint" style="margin-top:0">Saving actuals sends this amount to Nickey. Detention, extra, and reefer stay on this trip.</p>
      <div class="linehaul-field">
        ${moneyField("actualPay", "Line haul", draft.actualPay)}
      </div>
      <div class="sec-title">Add-ons on this trip</div>
      <p class="hint" style="margin-top:0">Saved on this trip only. Truck lease, insurance, IFTA, fuel, and truck wash stay on the pay week.</p>
      <div class="form-grid addon-grid">
        ${moneyField("actualDetention", "Detention", draft.actualDetention)}
        ${moneyField("actualExtra", "Extra pay", draft.actualExtra)}
        ${moneyField("actualReefer", "Reefer fuel", draft.actualReefer)}
      </div>
      <div class="var-card ${varClass}">
        <div class="k" style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted)">${esc(varLabel)}</div>
        <div class="big tabular">${v == null ? "—" : money(v, { signed: true })}</div>
        <div class="meta" style="color:var(--muted);font-size:0.8rem;margin-top:4px">
          Trip pay ${hasActuals(live) ? money(actualTotal(live)) : "—"} vs Frank ${money(estTotal(trip))} · band ${money(settings.tolerance)}
        </div>
      </div>
      <div class="sec-title">Notes</div>
      <div class="notes">
        ${(trip.notes || []).length ? trip.notes.map((n) => `
          <article class="note">
            <div class="who ${n.author === "Rosa" ? "rosa" : ""}">${esc(n.author || "Note")}<span class="when">${esc((n.timestamp || "").replace("T", " ").slice(0, 16))}</span></div>
            <p>${esc(n.text)}</p>
          </article>`).join("") : `<p class="empty">No notes yet.</p>`}
      </div>
      <div class="fld" style="margin-top:10px">
        <label for="noteText">Add a note as ${esc(currentAuthor())}</label>
        <textarea id="noteText" name="noteText" rows="3" placeholder="Pay-sheet discrepancy, dispatcher call, …">${esc(draft.noteText || "")}</textarea>
      </div>
      <button class="btn btn-ghost" type="button" data-act="add-note" style="margin-bottom:10px">Add note</button>
      <div class="sticky-save">
        <button class="btn btn-gold" data-act="save-actuals">Save actuals</button>
      </div>
    </div>
  </div>`;
}

const TOTAL_FIELDS = [
  ["truckLease", "Truck lease"],
  ["insurance", "Insurance"],
  ["ifta", "IFTA"],
  ["fuel", "Fuel"],
  ["truckWash", "Truck wash"],
  ["otherDeduction", "Other deduction"]
];

function blankToNull(v) {
  if (v == null || v === "") return null;
  return num(v);
}

function ensureTotalsDraft(weeklyTotals, sunday) {
  if (ui.totalsDraft && ui.totalsDraft.payWeek === sunday) return ui.totalsDraft;
  const existing = findWeeklyTotals(weeklyTotals, sunday);
  if (existing && existing.entered) {
    ui.totalsDraft = {
      payWeek: sunday,
      truckLease: existing.truckLease,
      insurance: existing.insurance,
      ifta: existing.ifta,
      fuel: existing.fuel,
      truckWash: existing.truckWash,
      otherDeduction: existing.otherDeduction,
      otherLabel: existing.otherLabel || "",
      prefilledFrom: existing.prefilledFrom || "",
      prefill: existing.prefill || null
    };
    return ui.totalsDraft;
  }
  const seeded = prefillWeeklyDraft(weeklyTotals, sunday);
  ui.totalsDraft = {
    payWeek: sunday,
    truckLease: seeded.truckLease,
    insurance: seeded.insurance,
    ifta: seeded.ifta,
    fuel: seeded.fuel,
    truckWash: seeded.truckWash,
    otherDeduction: seeded.otherDeduction,
    otherLabel: seeded.otherLabel || "",
    prefilledFrom: seeded.prefilledFrom || "",
    prefill: seeded.prefill
  };
  return ui.totalsDraft;
}

function totalsChip(draft, key) {
  if (!draft.prefill) return { cls: "", chip: "" };
  const edited = weeklyFieldEdited(draft[key], draft.prefill, key);
  if (edited) return { cls: "edited", chip: '<span class="chip ed">Edited</span>' };
  return { cls: "prefilled", chip: '<span class="chip pre">Prefill</span>' };
}

function renderTotals() {
  const { weeklyTotals } = getState();
  const sunday = ui.weekSunday;
  const draft = ensureTotalsDraft(weeklyTotals, sunday);
  const from = draft.prefilledFrom ? formatWeekRange(draft.prefilledFrom) : "";
  const fields = TOTAL_FIELDS.map(([key, label]) => {
    const chip = totalsChip(draft, key);
    return moneyField(key, label, draft[key], chip.cls, chip.chip);
  }).join("");
  const labelChip = totalsChip(draft, "otherLabel");
  return `<div class="app-shell no-nav">
    ${header("Weekly totals", formatWeekRange(sunday), { back: true })}
    <div class="trip">
      <p class="hint" style="margin-top:12px">One pay sheet for ${esc(formatWeekRange(sunday))} (Sunday–Saturday). ${from ? `Started from ${esc(from)}. Change only what is different — edited numbers are highlighted.` : "No earlier week to copy, so these start blank."}</p>
      <div class="totals-form">
        ${fields}
        <div class="fld ${labelChip.cls}">
          <label for="otherLabel">Other deduction label${labelChip.chip}</label>
          <input id="otherLabel" name="otherLabel" type="text" maxlength="80" placeholder="Label" value="${esc(draft.otherLabel || "")}">
        </div>
      </div>
      <div class="sticky-save">
        <button class="btn btn-gold" data-act="save-totals">Save weekly totals</button>
      </div>
    </div>
  </div>`;
}

function renderPnl() {
  const { trips, weeklyTotals } = getState();
  const year = ui.pnlYear;
  const pnl = pnlForYear(trips, year, weeklyTotals);
  const max = Math.max(1, ...pnl.months.map((m) => Math.max(m.moneyIn, m.moneyOut, m.estIn)));
  const months = ["J","F","M","A","M","J","J","A","S","O","N","D"];
  return `<div class="app-shell">
    ${header("Budget / P&L", String(year), { right: modePill() })}
    ${listenBanner()}
    <div class="period-nav">
      <button class="icon-btn" data-act="shift-pnl-year" data-dir="-1" aria-label="Previous year">${icon("back")}</button>
      <div class="label"><div class="main">${year}</div><div class="sub">Money in vs out · out is weekly totals</div></div>
      <button class="icon-btn" data-act="shift-pnl-year" data-dir="1" aria-label="Next year" style="transform:scaleX(-1)">${icon("back")}</button>
    </div>
    <div class="pnl">
      <div class="kpi-row">
        <div class="kpi"><div class="k">In</div><div class="v in tabular">${money(pnl.ytdIn)}</div></div>
        <div class="kpi"><div class="k">Out</div><div class="v out tabular">${money(pnl.ytdOut)}</div></div>
        <div class="kpi"><div class="k">Net</div><div class="v net tabular">${money(pnl.net)}</div></div>
      </div>
      <div class="chart-card">
        <h3>Monthly money in vs out</h3>
        <div class="bars">
          ${pnl.months.map((row, i) => {
            const inH = Math.round((row.moneyIn / max) * 126);
            const outH = Math.round((row.moneyOut / max) * 126);
            return `<div class="bar-col" title="${months[i]} in ${money(row.moneyIn)} out ${money(row.moneyOut)}">
              <div class="bar-pair">
                <div class="bar in" style="height:${inH}px"></div>
                <div class="bar out" style="height:${outH}px"></div>
              </div>
              <div class="mn">${months[i]}</div>
            </div>`;
          }).join("")}
        </div>
        <div class="legend-row"><span><i class="swatch" style="background:#7dcaa0"></i>Trip pay in</span><span><i class="swatch" style="background:#c45c78"></i>Weekly totals out</span></div>
      </div>
      <div class="chart-card">
        <h3>Estimate still on the books</h3>
        <p style="font-size:0.85rem;color:var(--muted);padding:0 6px 8px">YTD estimates ${money(pnl.ytdEst)} across ${pnl.tripCount} trips. Unbooked weeks still show on the calendar as Open.</p>
      </div>
      <div class="export-stack">
        <button class="btn btn-gold" data-act="export-xlsx">Export ${year} XLSX</button>
        <button class="btn btn-ghost" data-act="export-csv">Export ${year} CSV</button>
        <button class="btn btn-primary" data-act="simplywise">Import SimplyWise (stub)</button>
      </div>
    </div>
    ${nav("pnl")}
    ${ui.modal === "simplywise" ? simplyWiseModal() : ""}
  </div>`;
}

function simplyWiseModal() {
  return `<div class="modal" data-act="close-modal">
    <div class="modal-card" data-stop="1">
      <h2>SimplyWise</h2>
      <p class="sub" style="color:var(--muted);margin-bottom:12px">Receipt import is stubbed. Rosa still enters actuals from the pay sheet. A later update will map SimplyWise exports onto trip actuals and deductions.</p>
      <div class="fld"><label for="swfile">Drop a SimplyWise export (CSV / PDF)</label><input id="swfile" type="file" accept=".csv,.pdf,.xlsx,image/*"></div>
      <p class="hint" id="swstatus">No file parsed — this is a placeholder so the button has a home.</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-ghost" data-act="close-modal">Close</button>
      </div>
    </div>
  </div>`;
}

function renderSettings() {
  const { settings, mode, session } = getState();
  return `<div class="app-shell">
    ${header("More", mode === "demo" ? "Demo / offline" : (session?.email || "Signed in"), { right: modePill() })}
    <div class="settings">
      ${baselineCard()}
      <div class="card">
        <div class="sec-title" style="margin-top:0">Tolerance band</div>
        <p class="hint" style="margin-top:0">Flag a trip only when |actual − estimate| is greater than this dollar band. Small variances stay quiet.</p>
        <div class="tol-val tabular">${money(settings.tolerance)}</div>
        <input id="tol" type="range" min="0" max="250" step="5" value="${num(settings.tolerance)}">
      </div>
      <div class="card">
        <div class="sec-title" style="margin-top:0">Year export</div>
        <p class="hint" style="margin-top:0">One row per trip for ${ui.pnlYear}, plus a weekly totals section. CSV or XLSX.</p>
        <div class="export-stack">
          <button class="btn btn-gold" data-act="export-xlsx">Download XLSX</button>
          <button class="btn btn-ghost" data-act="export-csv">Download CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="sec-title" style="margin-top:0">SimplyWise</div>
        <button class="btn btn-primary" data-act="simplywise">Open import stub</button>
      </div>
      ${mode === "demo" ? `<div class="card">
        <div class="sec-title" style="margin-top:0">Demo data</div>
        <p class="hint" style="margin-top:0">Sample trips only. Sign in to see jobs Frank pushed from Nickey.</p>
        <div class="export-stack">
          ${isFirebaseConfigured() ? `<button class="btn btn-gold" data-act="goto-login">Sign in to live ledger</button>` : ""}
          <button class="btn btn-ghost" data-act="reset-demo">Reset sample trips</button>
        </div>
      </div>` : ""}
      <div class="card">
        <div class="sec-title" style="margin-top:0">Session</div>
        <p class="hint" style="margin-top:0">${mode === "firebase" ? `Live Firestore · ${esc(session?.email || "signed in")}.` : isFirebaseConfigured() ? "Firebase keys are present. You are in demo mode until you Sign in." : "Using demo mode until js/config.js is filled from Frank's Google Cloud project."}</p>
        <button class="btn btn-ghost" data-act="signout">Sign out</button>
      </div>
    </div>
    ${nav("settings")}
    ${ui.modal === "simplywise" ? simplyWiseModal() : ""}
  </div>`;
}

function render() {
  let html = "";
  if (ui.screen === "splash") html = renderSplash();
  else if (ui.screen === "login") html = renderLogin();
  else if (ui.screen === "week") html = renderWeek();
  else if (ui.screen === "totals") html = renderTotals();
  else if (ui.screen === "trip") html = renderTrip();
  else if (ui.screen === "pnl") html = renderPnl();
  else if (ui.screen === "settings") html = renderSettings();
  else html = renderCalendar();
  appEl.innerHTML = html;
  if (ui.screen === "week") {
    const hi = document.getElementById("day-" + ui.selectedDay);
    if (hi) hi.scrollIntoView({ block: "nearest", behavior: "auto" });
  }
}

function captureDraftFromForm() {
  if (!ui.draft) return;
  const ids = ["actualPay","actualDetention","actualExtra","actualReefer"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) ui.draft[id] = el.value === "" ? "" : el.value;
  }
  const note = document.getElementById("noteText");
  if (note) ui.draft.noteText = note.value;
}

function captureTotalsDraft() {
  if (!ui.totalsDraft) return;
  for (const [key] of TOTAL_FIELDS) {
    const el = document.getElementById(key);
    if (el) ui.totalsDraft[key] = el.value === "" ? "" : el.value;
  }
  const label = document.getElementById("otherLabel");
  if (label) ui.totalsDraft.otherLabel = label.value;
}

function shiftMonth(dir) {
  ui.cursor = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth() + dir, 1);
  go(`#/calendar/${ui.cursor.getFullYear()}/${ui.cursor.getMonth() + 1}`);
}

async function onClick(e) {
  const modalBg = e.target.closest("[data-act='close-modal']");
  if (modalBg && !e.target.closest("[data-stop]")) {
    ui.modal = null;
    render();
    return;
  }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "demo") {
    enterDemo();
    ui.screen = "calendar";
    go("#/calendar");
    render();
    return;
  }
  if (act === "goto-login") {
    ui.loginError = "";
    go("#/login");
    return;
  }
  if (act === "nav") { go(el.dataset.href); return; }
  if (act === "back") {
    if (ui.screen === "trip" || ui.screen === "totals") go(`#/week/${ui.weekSunday}/${ui.selectedDay}`);
    else history.length > 1 ? history.back() : go("#/calendar");
    return;
  }
  if (act === "cal-mode") {
    ui.calMode = el.dataset.mode;
    if (ui.calMode === "year") go(`#/calendar/year/${ui.cursor.getFullYear()}`);
    else if (ui.calMode === "day") go(`#/day/${ui.selectedDay}`);
    else go(`#/calendar/${ui.cursor.getFullYear()}/${ui.cursor.getMonth() + 1}`);
    return;
  }
  if (act === "shift-month") { shiftMonth(Number(el.dataset.dir)); return; }
  if (act === "shift-year") {
    ui.cursor = new Date(ui.cursor.getFullYear() + Number(el.dataset.dir), ui.cursor.getMonth(), 1);
    go(`#/calendar/year/${ui.cursor.getFullYear()}`);
    return;
  }
  if (act === "shift-day") {
    ui.selectedDay = addDays(ui.selectedDay, Number(el.dataset.dir));
    ui.weekSunday = startOfPayWeek(ui.selectedDay);
    const d = parseISODate(ui.selectedDay);
    if (d) ui.cursor = d;
    go(`#/day/${ui.selectedDay}`);
    return;
  }
  if (act === "shift-pnl-year") {
    ui.pnlYear += Number(el.dataset.dir);
    go(`#/pnl/${ui.pnlYear}`);
    return;
  }
  if (act === "open-day") {
    ui.selectedDay = el.dataset.day;
    ui.weekSunday = startOfPayWeek(ui.selectedDay);
    go(`#/week/${ui.weekSunday}/${ui.selectedDay}`);
    return;
  }
  if (act === "open-month") {
    ui.calMode = "month";
    ui.cursor = new Date(Number(el.dataset.year), Number(el.dataset.month) - 1, 1);
    go(`#/calendar/${el.dataset.year}/${el.dataset.month}`);
    return;
  }
  if (act === "open-week") {
    ui.weekSunday = el.dataset.sunday;
    ui.selectedDay = el.dataset.day || el.dataset.sunday;
    go(`#/week/${ui.weekSunday}/${ui.selectedDay}`);
    return;
  }
  if (act === "open-totals") {
    ui.weekSunday = el.dataset.sunday || ui.weekSunday;
    ui.totalsDraft = null;
    go(`#/totals/${ui.weekSunday}`);
    return;
  }
  if (act === "open-trip") {
    ui.tripId = el.dataset.id;
    ui.draft = null;
    const t = getState().trips.find((x) => x.id === ui.tripId);
    if (t) {
      ui.selectedDay = t.tripDate;
      ui.weekSunday = t.payWeek || startOfPayWeek(t.tripDate);
    }
    go(`#/trip/${ui.tripId}`);
    return;
  }
  if (act === "more-weeks") {
    ui.olderCount += 8;
    render();
    return;
  }
  if (act === "save-totals") {
    captureTotalsDraft();
    const d = ui.totalsDraft;
    if (!d) return;
    await saveWeeklyTotals({
      payWeek: ui.weekSunday,
      truckLease: blankToNull(d.truckLease),
      insurance: blankToNull(d.insurance),
      ifta: blankToNull(d.ifta),
      fuel: blankToNull(d.fuel),
      truckWash: blankToNull(d.truckWash),
      otherDeduction: blankToNull(d.otherDeduction),
      otherLabel: (d.otherLabel || "").trim(),
      prefilledFrom: d.prefilledFrom || "",
      prefill: d.prefill || null,
      entered: true,
      updatedAt: new Date().toISOString()
    });
    ui.totalsDraft = null;
    toast("Weekly totals saved");
    go(`#/week/${ui.weekSunday}/${ui.selectedDay}`);
    return;
  }
  if (act === "save-actuals") {
    captureDraftFromForm();
    const trip = getState().trips.find((t) => t.id === ui.tripId);
    if (!trip) return;
    const next = draftAsTrip(trip);
    await saveTrip(next);
    const hasLineHaul = next.actualPay != null && next.actualPay !== "";
    if (hasLineHaul) {
      const rec = publishTripBaseline(next);
      toast(next.flagged ? "Saved — flagged, line haul sent to Nickey" : "Actuals saved · Nickey baseline " + money(rec.amount));
    } else {
      toast(next.flagged ? "Saved — flagged outside band" : "Actuals saved");
    }
    ui.draft = null;
    render();
    return;
  }
  if (act === "add-note") {
    captureDraftFromForm();
    const text = (ui.draft?.noteText || "").trim();
    if (!text) { toast("Write a note first"); return; }
    const trip = getState().trips.find((t) => t.id === ui.tripId);
    if (!trip) return;
    const next = {
      ...draftAsTrip(trip),
      notes: [...(trip.notes || []), { text, author: currentAuthor(), timestamp: new Date().toISOString() }]
    };
    ui.draft.noteText = "";
    await saveTrip(next);
    toast("Note added");
    render();
    return;
  }
  if (act === "export-csv" || act === "export-xlsx") {
    exportYear(act === "export-xlsx" ? "xlsx" : "csv");
    return;
  }
  if (act === "simplywise") {
    ui.modal = "simplywise";
    render();
    return;
  }
  if (act === "close-modal") {
    ui.modal = null;
    render();
    return;
  }
  if (act === "reset-demo") {
    resetDemoData();
    ui.draft = null;
    ui.totalsDraft = null;
    toast("Sample trips restored");
    render();
    return;
  }
  if (act === "signout") {
    await signOutUser();
    ui.screen = "login";
    ui.draft = null;
    go("#/login");
    render();
  }
}

async function onSubmit(e) {
  const form = e.target.closest("form[data-act='login']");
  if (!form) return;
  e.preventDefault();
  ui.loginError = "";
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!isFirebaseConfigured()) {
    ui.loginError = "Firebase is not configured. Use demo mode or paste keys into js/config.js.";
    render();
    return;
  }
  ui.loginBusy = true;
  render();
  try {
    await signIn(email, password);
    ui.loginBusy = false;
    ui.screen = "calendar";
    go("#/calendar");
    render();
  } catch (err) {
    ui.loginBusy = false;
    ui.loginError = err.message || "Sign-in failed";
    render();
  }
}

function onInput(e) {
  if (e.target && e.target.id === "tol") {
    saveTolerance(e.target.value);
    const label = document.querySelector(".tol-val");
    if (label) label.textContent = money(e.target.value);
    return;
  }
  if (e.target && e.target.id === "swfile") {
    const status = document.getElementById("swstatus");
    const f = e.target.files && e.target.files[0];
    if (status && f) status.textContent = `Received ${f.name} (${Math.round(f.size / 1024)} KB) — parser not connected yet.`;
    return;
  }
  if (ui.screen === "totals") {
    const ids = TOTAL_FIELDS.map(([key]) => key).concat(["otherLabel"]);
    if (!ids.includes(e.target.id)) return;
    captureTotalsDraft();
    paintTotalsLive();
    return;
  }
  if (ui.screen !== "trip") return;
  const ids = ["actualPay","actualDetention","actualExtra","actualReefer","noteText"];
  if (!ids.includes(e.target.id)) return;
  captureDraftFromForm();
  paintTripLive();
}

function paintTripLive() {
  const trip = getState().trips.find((t) => t.id === ui.tripId);
  if (!trip || !ui.draft) return;
  const settings = getSettings();
  const live = draftAsTrip(trip);
  const v = varianceOf(live);
  const flagged = isFlagged(live, settings.tolerance);
  const wait = !hasActuals(live);
  const card = document.querySelector(".var-card");
  if (card) {
    card.className = "var-card " + (wait ? "wait" : flagged ? "bad" : "ok");
    const label = card.querySelector(".k");
    const big = card.querySelector(".big");
    const meta = card.querySelector(".meta");
    if (label) label.textContent = wait ? "Waiting on actuals" : flagged ? "Flagged — outside band" : "Within tolerance";
    if (big) big.textContent = v == null ? "—" : money(v, { signed: true });
    if (meta) meta.textContent = `Trip pay ${hasActuals(live) ? money(actualTotal(live)) : "—"} vs Frank ${money(estTotal(trip))} · band ${money(settings.tolerance)}`;
  }
}

function paintTotalsLive() {
  if (!ui.totalsDraft) return;
  const keys = TOTAL_FIELDS.map(([key]) => key).concat(["otherLabel"]);
  for (const key of keys) {
    const input = document.getElementById(key);
    if (!input) continue;
    const fld = input.closest(".fld");
    if (!fld) continue;
    const hasPrefill = Boolean(ui.totalsDraft.prefill);
    const edited = hasPrefill && weeklyFieldEdited(ui.totalsDraft[key], ui.totalsDraft.prefill, key);
    fld.classList.toggle("prefilled", hasPrefill && !edited);
    fld.classList.toggle("edited", edited);
    const label = fld.querySelector("label");
    if (!label) continue;
    const name = key === "otherLabel"
      ? "Other deduction label"
      : (TOTAL_FIELDS.find(([id]) => id === key) || ["", key])[1];
    const chip = !hasPrefill ? "" : edited
      ? '<span class="chip ed">Edited</span>'
      : '<span class="chip pre">Prefill</span>';
    label.innerHTML = `${name}${chip}`;
  }
}

function exportYear(kind) {
  const state = getState();
  const trips = tripsInYear(state.trips, ui.pnlYear);
  const weeks = weeklyTotalsInYear(state.weeklyTotals, ui.pnlYear);
  const rows = exportRows(trips, weeks);
  const pnl = pnlForYear(trips, ui.pnlYear, weeks);
  if (kind === "csv") {
    const csv = toCsv(rows);
    downloadBlob(`rosas-ledger-${ui.pnlYear}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
    toast("CSV downloaded");
    return;
  }
  const monthRows = [["Month", "Money in", "Money out", "Estimates", "Trips", "Flagged"]];
  pnl.months.forEach((m, i) => {
    monthRows.push([shortMonth(ui.pnlYear, i), m.moneyIn, m.moneyOut, m.estIn, m.trips, m.flagged]);
  });
  const blob = buildXlsx([
    { name: "Trips", rows: exportRows(trips) },
    { name: "Weekly totals", rows: weeklyExportRows(weeks) },
    { name: "P&L", rows: monthRows }
  ]);
  downloadBlob(`rosas-ledger-${ui.pnlYear}.xlsx`, blob);
  toast("XLSX downloaded");
}

appEl.addEventListener("click", onClick);
appEl.addEventListener("submit", onSubmit);
appEl.addEventListener("input", onInput);
appEl.addEventListener("change", onInput);

subscribe(() => {
  if (ui.screen !== "splash" && ui.screen !== "login") render();
});

async function boot() {
  render();
  await initStore();
  setTimeout(() => {
    const session = readSession();
    const hashTop = parseHash()[0] || "";
    // Demo sessions skip splash → calendar, but #/login always shows the form
    // so Sign in stays reachable after "Continue in demo mode".
    ui.screen = session && hashTop !== "login" ? "calendar" : "login";
    if (session && !location.hash) go("#/calendar");
    else applyHash();
    render();
  }, 2200);
}

boot();
