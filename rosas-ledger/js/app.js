import {
  addDays, actualTotal, applyVariance, deductTotal, downloadBlob, endOfPayWeek,
  estTotal, exportRows, formatLongDate, formatWeekRange, hasActuals, isFlagged,
  lane, lastDeduction, money, monthLabel, num, parseISODate, payWeekDays,
  pnlForYear, shortMonth, startOfPayWeek, toCsv, toISODate, todayISO,
  tripsInMonth, tripsInWeek, tripsInYear, tripsOnDay, varianceOf, weekdayShort,
  weekRunningTotal, weekShade
} from "./core.js";
import { buildXlsx } from "./xlsx-lite.js";
import {
  currentAuthor, enterDemo, getSettings, getState, initStore, isFirebaseConfigured,
  readSession, resetDemoData, saveTolerance, saveTrip, signIn, signOutUser, subscribe
} from "./store.js";

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
  modal: null,
  pnlYear: new Date().getFullYear(),
  exporting: false
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

function demoPill() {
  const s = getState();
  if (s.mode !== "demo") return "";
  return `<span class="demo-pill">Demo</span>`;
}

function renderSplash() {
  return `<section class="splash">
    <div class="splash-mark"><img src="./assets/icon.jpg" alt="Rosa's Ledger rose and eighteen-wheeler"></div>
    <h1>Rosa's Ledger<span>Pay verification</span></h1>
    <p class="tag">Estimate vs. actuals · Sun–Sat pay weeks</p>
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
      <button class="btn btn-primary" type="submit" ${configured ? "" : "disabled"}>Sign in</button>
      <div style="height:8px"></div>
      <button class="btn btn-gold" type="button" data-act="demo">Continue in demo mode</button>
      <p class="hint">Demo loads sample trips so calendar → week → trip → save actuals can be reviewed without Frank's Google Cloud project.</p>
    </form>
  </section>`;
}

function monthGrid(year, monthIndex, trips) {
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
    const cls = [
      "cell",
      onMonth ? "" : "out",
      weekShade(sunday) ? "shade-b" : "shade-a",
      dayTrips.length ? "has" : "",
      flagged ? "flagged" : "",
      iso === today ? "today" : "",
      iso === ui.selectedDay ? "selected" : ""
    ].filter(Boolean).join(" ");
    html += `<button type="button" class="${cls}" data-act="open-day" data-day="${iso}" aria-label="${iso}${dayTrips.length ? `, ${dayTrips.length} trip(s)` : ""}${flagged ? ", flagged" : ""}">
      <span class="n">${d.getDate()}</span>
      <span class="marks">${dayTrips.length ? '<i class="dot"></i>' : ""}${flagged ? '<i class="flag-pip"></i>' : ""}</span>
    </button>`;
  }
  html += "</div>";
  return html;
}

function renderCalendar() {
  const { trips, settings } = getState();
  const y = ui.cursor.getFullYear();
  const m = ui.cursor.getMonth();
  const sunday = startOfPayWeek(ui.selectedDay);
  const run = weekRunningTotal(trips, sunday);
  const displayTotal = run.actualCount ? run.actual : run.est;
  const switcher = `<div class="view-switch">
    <button class="${ui.calMode === "month" ? "on" : ""}" data-act="cal-mode" data-mode="month">Month</button>
    <button class="${ui.calMode === "year" ? "on" : ""}" data-act="cal-mode" data-mode="year">Year</button>
    <button class="${ui.calMode === "day" ? "on" : ""}" data-act="cal-mode" data-mode="day">Day</button>
  </div>`;

  let body = "";
  if (ui.calMode === "year") {
    const pnl = pnlForYear(trips, y);
    body = `<div class="period-nav">
      <button class="icon-btn" data-act="shift-year" data-dir="-1" aria-label="Previous year">${icon("back")}</button>
      <div class="label"><div class="main">${y}</div><div class="sub">Sun–Sat pay weeks · band ${money(settings.tolerance)}</div></div>
      <button class="icon-btn" data-act="shift-year" data-dir="1" aria-label="Next year" style="transform:scaleX(-1)">${icon("back")}</button>
    </div>
    <div class="year-grid">${pnl.months.map((row, i) => {
      const monthTrips = tripsInMonth(trips, y, i);
      const cls = ["month-card", i === new Date().getMonth() && y === new Date().getFullYear() ? "on" : "", row.flagged ? "flagged" : ""].filter(Boolean).join(" ");
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
    <div>${list.length ? list.map(tripRow).join("") : `<p class="empty" style="padding:18px 16px">No trips this day.</p>`}</div>
    <div style="padding:8px 14px 20px"><button class="btn btn-ghost" data-act="open-week" data-sunday="${sunday}" data-day="${ui.selectedDay}">Open full pay week</button></div>`;
  } else {
    body = `<div class="period-nav">
      <button class="icon-btn" data-act="shift-month" data-dir="-1" aria-label="Previous month">${icon("back")}</button>
      <div class="label"><div class="main">${monthLabel(y, m)}</div><div class="sub">Sun–Sat weeks · alt shading</div></div>
      <button class="icon-btn" data-act="shift-month" data-dir="1" aria-label="Next month" style="transform:scaleX(-1)">${icon("back")}</button>
    </div>
    <div class="cal">${monthGrid(y, m, trips)}</div>
    <div class="legend">
      <span><i class="dot"></i> Trip day</span>
      <span><i class="flag-pip"></i> Flagged (&gt; ${money(settings.tolerance)})</span>
      <span>Shaded = pay week</span>
    </div>
    <button class="week-summary" data-act="open-week" data-sunday="${sunday}" data-day="${ui.selectedDay}">
      <div class="k">Pay week ${esc(formatWeekRange(sunday))}</div>
      <div class="v tabular">${money(displayTotal)}</div>
      <div class="meta">${run.tripCount} trip${run.tripCount === 1 ? "" : "s"} · ${run.actualCount ? "actuals running" : "estimates"} · tap a day for the whole week</div>
    </button>`;
  }

  return `<div class="app-shell">
    ${header("Rosa's Ledger", "Bookkeeper companion", { right: demoPill() })}
    ${switcher}
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
      <div class="cities">${esc(ln.cities || formatLongDate(t.tripDate))}</div>
    </div>
    <div class="amt">
      <div class="est">Est ${money(estTotal(t))}</div>
      <div class="act ${actClass}">${wait ? "Enter actuals" : money(actual)}</div>
    </div>
  </button>`;
}

function renderWeek() {
  const { trips } = getState();
  const sunday = ui.weekSunday || startOfPayWeek(ui.selectedDay);
  const days = payWeekDays(sunday);
  const run = weekRunningTotal(trips, sunday);
  const shown = run.actualCount ? run.actual : run.est;
  const older = [];
  let cursor = addDays(sunday, -7);
  for (let i = 0; i < ui.olderCount; i++) {
    older.push(cursor);
    cursor = addDays(cursor, -7);
  }
  return `<div class="app-shell">
    ${header("Pay week", formatWeekRange(sunday), { back: true, right: demoPill() })}
    <div class="week-head">
      <div class="k">Running weekly total</div>
      <div class="range">${esc(formatWeekRange(sunday))}</div>
      <div class="tot tabular"><b>${money(shown)}</b> ${run.actualCount ? "actuals" : "estimated"} · ${run.tripCount} trip${run.tripCount === 1 ? "" : "s"}</div>
    </div>
    ${days.map((iso) => {
      const list = tripsOnDay(trips, iso);
      const hi = iso === ui.selectedDay ? " hi" : "";
      const d = parseISODate(iso);
      return `<section class="day-block${hi}" id="day-${iso}">
        <div class="dh"><span class="num">${d ? d.getDate() : ""}</span> ${weekdayShort(iso)}</div>
        ${list.length ? list.map(tripRow).join("") : `<div class="empty">No trips</div>`}
      </section>`;
    }).join("")}
    <div class="older">
      <h3>Older weeks</h3>
      ${older.map((sun) => {
        const r = weekRunningTotal(trips, sun);
        const tot = r.actualCount ? r.actual : r.est;
        const flag = tripsInWeek(trips, sun).some((t) => t.flagged);
        return `<button class="week-card" data-act="open-week" data-sunday="${sun}" data-day="${sun}">
          <div><div class="r">${esc(formatWeekRange(sun))}</div><div class="m">${r.tripCount} trip${r.tripCount === 1 ? "" : "s"}${flag ? " · flagged" : ""}</div></div>
          <div class="tabular">${r.tripCount ? money(tot) : "—"}</div>
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

function ensureDraft(trip, allTrips) {
  if (ui.draft && ui.draft.id === trip.id) return ui.draft;
  const leaseSaved = trip.deductLease != null && trip.deductLease !== "";
  const washSaved = trip.deductTruckWash != null && trip.deductTruckWash !== "";
  const leasePref = leaseSaved ? null : lastDeduction(allTrips, "deductLease", trip.tripDate, trip.id);
  const washPref = washSaved ? null : lastDeduction(allTrips, "deductTruckWash", trip.tripDate, trip.id);
  ui.draft = {
    id: trip.id,
    actualPay: trip.actualPay,
    actualDetention: trip.actualDetention,
    actualExtra: trip.actualExtra,
    actualReefer: trip.actualReefer,
    deductFuel: trip.deductFuel,
    deductInsurance: trip.deductInsurance,
    deductLease: leaseSaved ? trip.deductLease : leasePref.value,
    deductTruckWash: washSaved ? trip.deductTruckWash : washPref.value,
    noteText: "",
    leasePrefill: leasePref.value,
    washPrefill: washPref.value,
    leaseFrom: leasePref.fromTripId,
    washFrom: washPref.fromTripId
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
    actualReefer: d.actualReefer === "" || d.actualReefer == null ? null : num(d.actualReefer),
    deductFuel: d.deductFuel === "" || d.deductFuel == null ? null : num(d.deductFuel),
    deductInsurance: d.deductInsurance === "" || d.deductInsurance == null ? null : num(d.deductInsurance),
    deductLease: d.deductLease === "" || d.deductLease == null ? null : num(d.deductLease),
    deductTruckWash: d.deductTruckWash === "" || d.deductTruckWash == null ? null : num(d.deductTruckWash)
  };
  return applyVariance(next, getSettings().tolerance);
}

function renderTrip() {
  const { trips, settings } = getState();
  const trip = trips.find((t) => t.id === ui.tripId);
  if (!trip) {
    return `<div class="app-shell no-nav">${header("Missing trip", "", { back: true })}<p class="empty">That trip is not on the ledger.</p></div>`;
  }
  const draft = ensureDraft(trip, trips);
  const live = draftAsTrip(trip);
  const ln = lane(trip);
  const v = varianceOf(live);
  const flagged = isFlagged(live, settings.tolerance);
  const wait = !hasActuals(live);
  const varClass = wait ? "wait" : flagged ? "bad" : "ok";
  const varLabel = wait ? "Waiting on actuals" : flagged ? "Flagged — outside band" : "Within tolerance";
  const leaseEdited = draft.leasePrefill != null && num(draft.deductLease) !== num(draft.leasePrefill);
  const washEdited = draft.washPrefill != null && num(draft.deductTruckWash) !== num(draft.washPrefill);
  const leaseChip = draft.leasePrefill != null
    ? (leaseEdited ? '<span class="chip ed">Edited</span>' : '<span class="chip pre">Prefill</span>')
    : "";
  const washChip = draft.washPrefill != null
    ? (washEdited ? '<span class="chip ed">Edited</span>' : '<span class="chip pre">Prefill</span>')
    : "";

  return `<div class="app-shell no-nav">
    ${header(ln.parties || "Trip", formatLongDate(trip.tripDate), { back: true })}
    <div class="trip">
      <div class="trip-hero">
        <div class="lane">${esc(ln.parties || trip.id)}</div>
        <div class="cities">${esc(ln.cities)}</div>
        <div class="meta">
          <span>Pay week ${esc(formatWeekRange(trip.payWeek))}</span>
          <span>${trip.miles || "—"} mi</span>
          <span>${trip.costPerMile ? money(trip.costPerMile) + "/mi" : ""}</span>
        </div>
      </div>
      <div class="sec-title">Frank's estimate</div>
      <div class="est-grid">
        <div class="kv"><div class="k">Linehaul</div><div class="v">${money(trip.estLinehaul)}</div></div>
        <div class="kv"><div class="k">Detention</div><div class="v">${money(trip.estDetention)}</div></div>
        <div class="kv"><div class="k">Extra pay</div><div class="v">${money(trip.estExtraPay)}</div></div>
        <div class="kv"><div class="k">Reefer fuel</div><div class="v">${money(trip.estReeferFuel)}</div></div>
      </div>
      <div class="est-grid" style="margin-top:8px">
        <div class="kv"><div class="k">Odo in / out</div><div class="v">${trip.odometerIn ?? "—"} → ${trip.odometerOut ?? "—"}</div></div>
        <div class="kv"><div class="k">Est total</div><div class="v">${money(estTotal(trip))}</div></div>
      </div>
      <div class="sec-title">Rosa's actuals</div>
      <div class="form-grid">
        ${moneyField("actualPay", "Actual pay", draft.actualPay)}
        ${moneyField("actualDetention", "Actual detention", draft.actualDetention)}
        ${moneyField("actualExtra", "Actual extra", draft.actualExtra)}
        ${moneyField("actualReefer", "Actual reefer", draft.actualReefer)}
      </div>
      <div class="sec-title">Deductions</div>
      <div class="form-grid">
        ${moneyField("deductFuel", "Fuel", draft.deductFuel)}
        ${moneyField("deductInsurance", "Insurance", draft.deductInsurance)}
        ${moneyField("deductLease", "Lease", draft.deductLease, leaseEdited ? "edited" : (draft.leasePrefill != null ? "prefilled" : ""), leaseChip)}
        ${moneyField("deductTruckWash", "Truck wash", draft.deductTruckWash, washEdited ? "edited" : (draft.washPrefill != null ? "prefilled" : ""), washChip)}
      </div>
      <div class="var-card ${varClass}">
        <div class="k" style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted)">${esc(varLabel)}</div>
        <div class="big tabular">${v == null ? "—" : money(v, { signed: true })}</div>
        <div class="meta" style="color:var(--muted);font-size:0.8rem;margin-top:4px">
          Actual ${hasActuals(live) ? money(actualTotal(live)) : "—"} vs est ${money(estTotal(trip))} · deductions ${money(deductTotal(live))} · band ${money(settings.tolerance)}
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

function renderPnl() {
  const { trips } = getState();
  const year = ui.pnlYear;
  const pnl = pnlForYear(trips, year);
  const max = Math.max(1, ...pnl.months.map((m) => Math.max(m.moneyIn, m.moneyOut, m.estIn)));
  const months = ["J","F","M","A","M","J","J","A","S","O","N","D"];
  return `<div class="app-shell">
    ${header("Budget / P&L", String(year), { right: demoPill() })}
    <div class="period-nav">
      <button class="icon-btn" data-act="shift-pnl-year" data-dir="-1" aria-label="Previous year">${icon("back")}</button>
      <div class="label"><div class="main">${year}</div><div class="sub">Money in vs out · booked actuals</div></div>
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
        <div class="legend-row"><span><i class="swatch" style="background:#7dcaa0"></i>Actual in</span><span><i class="swatch" style="background:#c45c78"></i>Deductions</span></div>
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
    ${header("More", mode === "demo" ? "Demo / offline" : (session?.email || "Signed in"), { right: demoPill() })}
    <div class="settings">
      <div class="card">
        <div class="sec-title" style="margin-top:0">Tolerance band</div>
        <p class="hint" style="margin-top:0">Flag a trip only when |actual − estimate| is greater than this dollar band. Small variances stay quiet.</p>
        <div class="tol-val tabular">${money(settings.tolerance)}</div>
        <input id="tol" type="range" min="0" max="250" step="5" value="${num(settings.tolerance)}">
      </div>
      <div class="card">
        <div class="sec-title" style="margin-top:0">Year export</div>
        <p class="hint" style="margin-top:0">Spreadsheet of the trip contract for ${ui.pnlYear} — CSV or XLSX, no extra library.</p>
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
        <button class="btn btn-ghost" data-act="reset-demo">Reset sample trips</button>
      </div>` : ""}
      <div class="card">
        <div class="sec-title" style="margin-top:0">Session</div>
        <p class="hint" style="margin-top:0">${isFirebaseConfigured() ? "Firebase keys are present." : "Using demo mode until js/config.js is filled from Frank's Google Cloud project."}</p>
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
  const ids = ["actualPay","actualDetention","actualExtra","actualReefer","deductFuel","deductInsurance","deductLease","deductTruckWash"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) ui.draft[id] = el.value === "" ? "" : el.value;
  }
  const note = document.getElementById("noteText");
  if (note) ui.draft.noteText = note.value;
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
  if (act === "nav") { go(el.dataset.href); return; }
  if (act === "back") {
    if (ui.screen === "trip") go(`#/week/${ui.weekSunday}/${ui.selectedDay}`);
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
  if (act === "save-actuals") {
    captureDraftFromForm();
    const trip = getState().trips.find((t) => t.id === ui.tripId);
    if (!trip) return;
    const next = draftAsTrip(trip);
    await saveTrip(next);
    ui.draft = null;
    toast(next.flagged ? "Saved — flagged outside band" : "Actuals saved");
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
  try {
    await signIn(email, password);
    ui.screen = "calendar";
    go("#/calendar");
    render();
  } catch (err) {
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
  if (ui.screen !== "trip") return;
  const ids = ["actualPay","actualDetention","actualExtra","actualReefer","deductFuel","deductInsurance","deductLease","deductTruckWash","noteText"];
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
    if (meta) meta.textContent = `Actual ${hasActuals(live) ? money(actualTotal(live)) : "—"} vs est ${money(estTotal(trip))} · deductions ${money(deductTotal(live))} · band ${money(settings.tolerance)}`;
  }
  const leaseEdited = ui.draft.leasePrefill != null && num(ui.draft.deductLease) !== num(ui.draft.leasePrefill);
  const washEdited = ui.draft.washPrefill != null && num(ui.draft.deductTruckWash) !== num(ui.draft.washPrefill);
  paintDeductField("deductLease", ui.draft.leasePrefill != null, leaseEdited);
  paintDeductField("deductTruckWash", ui.draft.washPrefill != null, washEdited);
}

function paintDeductField(id, hasPrefill, edited) {
  const input = document.getElementById(id);
  if (!input) return;
  const fld = input.closest(".fld");
  if (!fld) return;
  fld.classList.toggle("prefilled", hasPrefill && !edited);
  fld.classList.toggle("edited", Boolean(edited));
  const label = fld.querySelector("label");
  if (!label) return;
  const name = id === "deductLease" ? "Lease" : "Truck wash";
  const chip = !hasPrefill ? "" : edited
    ? '<span class="chip ed">Edited</span>'
    : '<span class="chip pre">Prefill</span>';
  label.innerHTML = `${name}${chip}`;
}

function exportYear(kind) {
  const trips = tripsInYear(getState().trips, ui.pnlYear);
  const rows = exportRows(trips);
  const pnl = pnlForYear(trips, ui.pnlYear);
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
    { name: "Trips", rows },
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
    ui.screen = readSession() ? "calendar" : "login";
    if (readSession() && !location.hash) go("#/calendar");
    else applyHash();
    render();
  }, 2200);
}

boot();
