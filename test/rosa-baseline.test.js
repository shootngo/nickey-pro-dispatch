'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const baseline = require('../nickey-rosa-baseline.js');

function memoryStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _raw: store
  };
}

describe('rosa/nickey baseline contract', () => {
  it('exports the shared localStorage key used by both apps', () => {
    assert.equal(baseline.KEY, 'nickeyRosa.baseline');
    assert.equal(baseline.TS_KEY, 'ndsync_ts_nickeyRosa.baseline');
  });

  it('treats a missing key as no baseline (not a static $900)', () => {
    const rec = baseline.read(memoryStorage());
    assert.equal(rec.amount, null);
    assert.equal(baseline.hasAmount(rec), false);
    const cmp = baseline.compareEstimate(1050, rec.amount);
    assert.equal(cmp.tone, 'none');
    assert.equal(cmp.baseline, null);
  });

  it('publishes line haul only, not pay plus detention, extra, and reefer', () => {
    const storage = memoryStorage();
    const rec = baseline.publishFromTrip({
      id: 'TRP-1',
      tripDate: '2026-09-08',
      payWeek: '2026-09-06',
      pickup: '3012 874535',
      consignee: 'Kroger DC',
      actualPay: 1100,
      actualDetention: 80,
      actualExtra: 0,
      actualReefer: 20
    }, '2026-09-16T12:00:00.000Z', storage);
    assert.equal(rec.amount, 1100);
    assert.notEqual(rec.amount, 1200);
    assert.equal(rec.kind, 'trip');
    assert.equal(rec.payWeek, '2026-09-06');
    assert.equal(rec.pickup, '3012874535');
    assert.match(rec.label, /Kroger DC/);
    assert.match(rec.label, /line haul/);
    assert.equal(JSON.parse(storage.getItem(baseline.KEY)).amount, 1100);
    assert.equal(storage.getItem(baseline.TS_KEY), '2026-09-16T12:00:00.000Z');
    assert.equal(rec.lastActuals.length, 1);
    assert.equal(rec.lastActuals[0].amount, 1100);
  });

  it('sets a Maxson baseline from line haul ~388.80, not add-ons or the week gross', () => {
    const storage = memoryStorage();
    const rec = baseline.publishFromTrip({
      id: 'TRP-maxson',
      tripDate: '2026-09-10',
      consignee: 'Maxson',
      actualPay: 388.8,
      actualDetention: 150,
      actualExtra: 25,
      actualReefer: 40
    }, '2026-09-23T12:00:00.000Z', storage);
    assert.equal(rec.amount, 388.8);
    assert.equal(rec.kind, 'trip');
    assert.match(rec.label, /Maxson/);
    assert.match(rec.label, /line haul/);
    assert.notEqual(rec.amount, 603.8);
    assert.notEqual(rec.amount, 8945.5);
    const cmp = baseline.compareEstimate(388.8, rec.amount);
    assert.equal(cmp.tone, 'even');
    assert.match(baseline.compareSummary(cmp), /line haul \$388\.80/);
    assert.doesNotMatch(baseline.compareSummary(cmp), /8,945\.50|603\.80/);
  });

  it('does not publish when Rosa has not entered actuals', () => {
    const storage = memoryStorage();
    const rec = baseline.publishFromTrip({
      id: 'TRP-open',
      tripDate: '2026-09-08',
      actualPay: null,
      actualDetention: null
    }, '2026-09-16T12:00:00.000Z', storage);
    assert.equal(rec.amount, null);
    assert.equal(storage.getItem(baseline.KEY), null);
  });

  it('does not publish detention or other add-ons when line haul is blank', () => {
    const storage = memoryStorage();
    const rec = baseline.publishFromTrip({
      id: 'TRP-addons',
      tripDate: '2026-09-10',
      consignee: 'Maxson',
      actualPay: null,
      actualDetention: 150,
      actualExtra: 25,
      actualReefer: 40
    }, '2026-09-23T12:00:00.000Z', storage);
    assert.equal(rec.amount, null);
    assert.equal(storage.getItem(baseline.KEY), null);
    assert.equal(baseline.lineHaulAmount({ actualPay: 388.8, actualDetention: 150 }), 388.8);
  });

  it('publishes one trip actual and leaves the other Pros in that week alone', () => {
    const storage = memoryStorage();
    const rec = baseline.publishFromTrip({
      id: '605621',
      tripDate: '2026-08-31',
      payWeek: '2026-08-30',
      consignee: 'Vi-Jon',
      actualPay: 1398.27,
      actualDetention: 0,
      actualExtra: 0,
      actualReefer: 0
    }, '2026-09-16T12:00:00.000Z', storage);
    assert.equal(rec.amount, 1398.27);
    assert.equal(rec.kind, 'trip');
    assert.match(rec.label, /Vi-Jon/);
    assert.notEqual(rec.amount, 8945.5);
    assert.equal(typeof baseline.publishFromWeek, 'undefined');
  });

  it('clears a leftover week gross so it cannot be Current Baseline', () => {
    const storage = memoryStorage({
      [baseline.KEY]: JSON.stringify({
        version: 1,
        amount: 8945.5,
        kind: 'week',
        payWeek: '2026-08-30',
        label: 'Aug 30–Sep 5 · confirmed',
        savedAt: '2026-09-06T00:00:00.000Z',
        lastActuals: [{
          amount: 1398.27,
          tripId: '605621',
          consignee: 'Vi-Jon',
          tripDate: '2026-08-31',
          payWeek: '2026-08-30',
          savedAt: '2026-09-01T00:00:00.000Z'
        }, {
          amount: 8945.5,
          tripId: '',
          consignee: 'Maxson',
          savedAt: '2026-09-06T00:00:00.000Z'
        }]
      }),
      [baseline.TS_KEY]: '2026-09-06T00:00:00.000Z'
    });
    const rec = baseline.read(storage);
    assert.equal(rec.amount, null);
    assert.equal(rec.kind, '');
    assert.equal(rec.label, '');
    assert.equal(baseline.hasAmount(rec), false);
    assert.equal(rec.lastActuals.length, 1);
    assert.equal(rec.lastActuals[0].amount, 1398.27);
    const stored = JSON.parse(storage.getItem(baseline.KEY));
    assert.equal(stored.amount, null);
    assert.notEqual(stored.kind, 'week');
    assert.doesNotMatch(JSON.stringify(stored), /8945\.5/);
    const ts = storage.getItem(baseline.TS_KEY);
    assert.ok(ts > '2026-09-06T00:00:00.000Z');
    assert.equal(stored.savedAt, ts);
    const raw = storage.getItem(baseline.KEY);
    const rec2 = baseline.read(storage);
    assert.equal(rec2.amount, null);
    assert.equal(storage.getItem(baseline.KEY), raw);
    assert.equal(storage.getItem(baseline.TS_KEY), ts);
    const cmp = baseline.compareEstimate(388.8, rec.amount);
    assert.equal(cmp.baseline, null);
    assert.equal(cmp.tone, 'none');
    assert.match(baseline.compareSummary(cmp), /No baseline yet/);
    assert.doesNotMatch(baseline.compareSummary(cmp), /8,945\.50|8945\.50/);
    assert.equal(baseline.lastActualForCustomer('Maxson', storage), null);
    assert.equal(baseline.lastActualForCustomer('Vi-Jon', storage).amount, 1398.27);
    const normalized = baseline.normalize({ kind: 'week', amount: 8945.5, label: 'Week of Aug 30–Sep 5' });
    assert.equal(normalized.amount, null);
    assert.equal(normalized.kind, '');
  });

  it('stamps a cleared week record after a future-dated Drive timestamp', () => {
    const storage = memoryStorage({
      [baseline.KEY]: JSON.stringify({
        version: 1,
        amount: 8945.5,
        kind: 'week',
        payWeek: '2026-08-30',
        savedAt: '2026-12-01T00:00:00.000Z'
      }),
      [baseline.TS_KEY]: '2026-12-01T00:00:00.000Z'
    });
    const rec = baseline.read(storage);
    assert.equal(rec.amount, null);
    assert.ok(storage.getItem(baseline.TS_KEY) > '2026-12-01T00:00:00.000Z');
    const bare = memoryStorage({
      [baseline.KEY]: JSON.stringify({
        version: 1,
        amount: 8945.5,
        kind: 'week',
        savedAt: '2026-12-01T00:00:00Z'
      }),
      [baseline.TS_KEY]: '2026-12-01T00:00:00Z'
    });
    baseline.read(bare);
    assert.ok(bare.getItem(baseline.TS_KEY) > '2026-12-01T00:00:00Z');
  });

  it('does not persist a week gross when write is handed a week record', () => {
    const storage = memoryStorage();
    const rec = baseline.write({
      kind: 'week',
      amount: 8945.5,
      payWeek: '2026-08-30',
      label: 'Week of Aug 30–Sep 5 · 4 trips',
      savedAt: '2026-09-06T00:00:00.000Z'
    }, storage, '2026-09-06T00:00:00.000Z');
    assert.equal(rec.amount, null);
    assert.equal(rec.kind, '');
    assert.equal(JSON.parse(storage.getItem(baseline.KEY)).amount, null);
    assert.ok(storage.getItem(baseline.TS_KEY) > '2026-09-06T00:00:00.000Z');
  });

  it('still accepts a trip actual after a week record was cleared', () => {
    const storage = memoryStorage({
      [baseline.KEY]: JSON.stringify({
        version: 1,
        amount: 8945.5,
        kind: 'week',
        payWeek: '2026-08-30'
      })
    });
    baseline.read(storage);
    const rec = baseline.publishFromTrip({
      id: 'TRP-maxson',
      tripDate: '2026-09-10',
      consignee: 'Maxson',
      actualPay: 388.8
    }, '2026-09-23T12:00:00.000Z', storage);
    assert.equal(rec.kind, 'trip');
    assert.equal(rec.amount, 388.8);
    assert.equal(baseline.hasAmount(rec), true);
    const cmp = baseline.compareEstimate(388.8, rec.amount);
    assert.equal(cmp.tone, 'even');
    assert.equal(cmp.baseline, 388.8);
  });

  it('accepts a typed single-trip amount from Rosa', () => {
    const storage = memoryStorage();
    const rec = baseline.publishManual({
      amount: 1200,
      payWeek: '2026-09-06',
      label: 'Pay sheet week'
    }, '2026-09-16T12:00:00.000Z', storage);
    assert.equal(rec.amount, 1200);
    assert.equal(rec.kind, 'manual');
    assert.equal(rec.label, 'Pay sheet week');
  });

  it('compares estimated load pay against last actual', () => {
    const over = baseline.compareEstimate(1300, 1200);
    assert.equal(over.delta, 100);
    assert.equal(over.tone, 'over');
    const under = baseline.compareEstimate(1050, 1200);
    assert.equal(under.delta, -150);
    assert.equal(under.tone, 'under');
    const even = baseline.compareEstimate(1200, 1200);
    assert.equal(even.tone, 'even');
    assert.match(baseline.compareSummary(under), /line haul \$1,200\.00/);
    assert.match(baseline.compareSummary(under), /Est\. \$1,050\.00/);
  });

  it('prefers a matching customer in lastActuals', () => {
    const storage = memoryStorage();
    baseline.publishFromTrip({
      id: 'A', tripDate: '2026-09-01', consignee: 'Sysco', actualPay: 900
    }, '2026-09-01T00:00:00.000Z', storage);
    baseline.publishFromTrip({
      id: 'B', tripDate: '2026-09-08', consignee: 'Kroger DC', actualPay: 1200
    }, '2026-09-08T00:00:00.000Z', storage);
    const hit = baseline.lastActualForCustomer('Sysco', storage);
    assert.equal(hit.amount, 900);
    assert.equal(baseline.lastActualForCustomer('Kroger DC', storage).amount, 1200);
  });

  it('asks Nickey to upload a local line haul when Drive has no baseline key', () => {
    const raw = JSON.stringify({
      version: 1, amount: 388.8, kind: 'trip', consignee: 'Maxson',
      label: 'Maxson · Sep 10 · line haul'
    });
    const ts = '2026-09-23T14:00:00.000Z';
    assert.equal(baseline.shouldUploadToDrive(raw, ts, null), true);
    assert.equal(baseline.shouldUploadToDrive(raw, ts, undefined), true);
    assert.equal(baseline.shouldUploadToDrive(null, ts, null), false);
    assert.equal(baseline.shouldUploadToDrive('', ts, null), false);
    assert.equal(baseline.shouldUploadToDrive(raw, ts, { value: raw, updatedAt: ts }), false);
    assert.equal(baseline.shouldUploadToDrive(raw, '2026-09-23T15:00:00.000Z', {
      value: JSON.stringify({ amount: 900, kind: 'trip' }),
      updatedAt: ts
    }), true);
    assert.equal(baseline.shouldUploadToDrive(raw, '2026-09-23T12:00:00.000Z', {
      value: JSON.stringify({ amount: 900, kind: 'trip' }),
      updatedAt: '2026-09-23T14:00:00.000Z'
    }), false);
  });

  it('treats this week and last week as recent for the default checkbox', () => {
    assert.equal(baseline.isRecentPayWeek('2026-09-08', '2026-09-16'), true); // this week (Sun 13)
    assert.equal(baseline.isRecentPayWeek('2026-09-10', '2026-09-16'), true);
    assert.equal(baseline.isRecentPayWeek('2026-09-06', '2026-09-16'), true); // prior week Sun 6
    assert.equal(baseline.isRecentPayWeek('2026-08-20', '2026-09-16'), false);
  });
});

describe('baseline is wired into Nickey / Rosa / Drive', () => {
  const root = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('Nickey precaches the shared module and Drive-syncs the key', () => {
    const sw = read('sw.js');
    const ndsync = read('ndsync.js');
    const persist = read('nickey-persist.js');
    const html = read('index.html');
    assert.match(sw, /nickey-rosa-baseline\.js/);
    assert.match(html, /nickey-rosa-baseline\.js/);
    const syncBlock = ndsync.slice(ndsync.indexOf('const SYNC_KEYS'), ndsync.indexOf('const SYNC_KEY_SET'));
    assert.match(syncBlock, /nickeyRosa\.baseline/);
    assert.match(persist, /nickeyRosa\.baseline/);
    assert.match(ndsync, /function baselineShouldUpload/);
    assert.match(ndsync, /uploadBaseline/);
    assert.match(ndsync, /shouldUploadToDrive/);
    assert.match(ndsync, /keys\['nickeyRosa\.baseline'\]/);
    const pull = ndsync.slice(ndsync.indexOf('function pullFromDrive'), ndsync.indexOf('function pushToDrive'));
    assert.match(pull, /baselineShouldUpload\(data\)/);
    assert.match(pull, /uploadBaseline/);
    const setup = ndsync.slice(ndsync.indexOf('function setupAndPull'), ndsync.indexOf('function notifyPageOfPull'));
    assert.match(setup, /result\.uploadBaseline/);
    assert.match(setup, /debouncedPush\(\)/);
    assert.match(ndsync, /addEventListener\('storage'/);
  });

  it('shows Current Baseline on the dashboard instead of a static default', () => {
    const html = read('index.html');
    assert.match(html, /id="baselineBanner"/);
    assert.match(html, /Current Baseline/);
    assert.doesNotMatch(html, /Current Baseline: \$900/);
    assert.match(html, /id="payCompareBox"/);
    assert.match(html, /rec\.kind === 'week'/);
    assert.doesNotMatch(html, /weekLabel\(rec\.payWeek\)/);
  });

  it('keeps the dispatch inline script parseable (splash + baseline UI)', () => {
    const html = read('index.html');
    const start = html.indexOf('const TRUCK_IMG=');
    const end = html.indexOf('</script>', start);
    assert.ok(start > 0 && end > start);
    const inline = html.slice(start, end);
    assert.doesNotThrow(() => new vm.Script(inline, { filename: 'index-inline.js' }));
    assert.match(inline, /function refreshAllBaselineUI/);
  });

  it('Rosa saves actuals onto the shared key', () => {
    const app = read('rosas-ledger/js/app.js');
    const store = read('rosas-ledger/js/store.js');
    const rosaHtml = read('rosas-ledger/index.html');
    assert.match(rosaHtml, /nickey-rosa-baseline\.js/);
    const tripStart = app.indexOf('function renderTrip');
    const tripEnd = app.indexOf('const TOTAL_FIELDS');
    const trip = app.slice(tripStart, tripEnd);
    assert.ok(tripStart > 0 && tripEnd > tripStart);
    assert.doesNotMatch(trip, /baselineCard|Nickey baseline|setNickeyBaseline|refresh-nickey-baseline|Set as Frank|Line haul → Nickey/);
    assert.match(trip, /data-act="save-actuals"/);
    assert.match(trip, /actualPay/);
    const saveStart = app.indexOf('act === "save-actuals"');
    const saveEnd = app.indexOf('act === "add-note"');
    const save = app.slice(saveStart, saveEnd);
    assert.match(save, /publishTripBaseline\(next\)/);
    assert.match(save, /await saveTrip\(next\)/);
    assert.doesNotMatch(save, /wantBaseline|setNickeyBaseline|checked/);
    assert.doesNotMatch(app, /refresh-nickey-baseline|send-manual-baseline|Set as Frank|Refresh Nickey baseline|publishManualBaseline/);
    const weekStart = app.indexOf('function renderWeek');
    const weekEnd = app.indexOf('function moneyField');
    const week = app.slice(weekStart, weekEnd);
    assert.match(week, /baselineCard/);
    assert.match(week, /weekMathBlock/);
    assert.match(app, /Week gross/);
    assert.doesNotMatch(app, /send-week-baseline|publishWeekBaseline|weekBaselineAmt/);
    assert.doesNotMatch(app, /This saved amount is a week total/);
    assert.doesNotMatch(app, /pay, detention, extra, and reefer/);
    assert.doesNotMatch(app, /booked actuals to Nickey|send the total to Nickey/);
    assert.doesNotMatch(store, /publishFromWeek|publishWeekBaseline/);
    assert.match(store, /NickeyRosaBaseline|nickeyRosa\.baseline/);
    assert.match(store, /publishFromTrip/);
    const helper = read('nickey-rosa-baseline.js');
    assert.doesNotMatch(helper, /function publishFromWeek/);
    assert.match(helper, /function lineHaulAmount/);
  });
});
