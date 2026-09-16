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

  it('publishes a trip actual total as the new baseline', () => {
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
    assert.equal(rec.amount, 1200);
    assert.equal(rec.kind, 'trip');
    assert.equal(rec.payWeek, '2026-09-06');
    assert.equal(rec.pickup, '3012874535');
    assert.match(rec.label, /Kroger DC/);
    assert.equal(JSON.parse(storage.getItem(baseline.KEY)).amount, 1200);
    assert.equal(storage.getItem(baseline.TS_KEY), '2026-09-16T12:00:00.000Z');
    assert.equal(rec.lastActuals.length, 1);
    assert.equal(rec.lastActuals[0].amount, 1200);
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

  it('sums booked actuals for a pay week', () => {
    const storage = memoryStorage();
    const trips = [
      { payWeek: '2026-09-06', actualPay: 800, actualDetention: 0, actualExtra: 0, actualReefer: 0 },
      { payWeek: '2026-09-06', actualPay: 400, actualDetention: 0, actualExtra: 0, actualReefer: 0 },
      { payWeek: '2026-08-30', actualPay: 999, actualDetention: 0, actualExtra: 0, actualReefer: 0 }
    ];
    const rec = baseline.publishFromWeek(trips, '2026-09-06', '2026-09-16T12:00:00.000Z', storage);
    assert.equal(rec.amount, 1200);
    assert.equal(rec.kind, 'week');
    assert.match(rec.label, /2 trips/);
  });

  it('accepts a typed period total from Rosa', () => {
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
    assert.match(baseline.compareSummary(under), /last actual \$1,200\.00/);
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
  });

  it('shows Current Baseline on the dashboard instead of a static default', () => {
    const html = read('index.html');
    assert.match(html, /id="baselineBanner"/);
    assert.match(html, /Current Baseline/);
    assert.doesNotMatch(html, /Current Baseline: \$900/);
    assert.match(html, /id="payCompareBox"/);
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
    assert.match(app, /Set as Frank/);
    assert.match(app, /publishFromTrip|publishFromWeek|publishManual/);
    assert.match(store, /NickeyRosaBaseline|nickeyRosa\.baseline/);
  });
});
