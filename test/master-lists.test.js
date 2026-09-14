'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('hamburger Settings master lists persist', () => {
  const html = read('index.html');
  const shared = read('nickey-shared.js');
  const persist = read('nickey-persist.js');
  const ndsync = read('ndsync.js');
  const sw = read('sw.js');

  it('renders the trailers Settings list (was an empty #trailerList)', () => {
    assert.match(html, /id="trailerList"/);
    assert.match(html, /function renderTrailerList\(/);
    assert.match(html, /function reloadHamburgerLists\(/);
    assert.match(html, /function deleteTrailer\(/);
  });

  it('saves customers and trailers through durable persist, then re-renders', () => {
    assert.match(html, /var ok=ndSaveCustomers\(customers\);renderCustomerList\(\)/);
    assert.match(html, /var ok=ndSaveTrailers\(allTrailers\);renderTrailerList\(\)/);
    assert.match(html, /switchSettingsTab[\s\S]*if\(tab===1\) renderTrailerList\(\)/);
    assert.match(html, /ndSaveCustomers\(customers\)/);
    assert.doesNotMatch(html, /localStorage\.setItem\("nickeyCustomers"/);
  });

  it('reloads hamburger lists after Drive pull, pageshow, and IndexedDB hydrate', () => {
    assert.match(html, /ndsync:pulled[\s\S]*reloadHamburgerLists\(\)/);
    assert.match(html, /pageshow[\s\S]*reloadHamburgerLists\(\)/);
    assert.match(html, /hydrateFromIndexedDB[\s\S]*reloadHamburgerLists\(\)/);
    assert.match(ndsync, /reloadHamburgerLists/);
    assert.match(ndsync, /flushPendingPush/);
    assert.match(ndsync, /pagehide[\s\S]*flushPendingPush/);
  });

  it('includes nickeyTrailers in Drive sync and backup export', () => {
    assert.match(ndsync, /'nickeyTrailers'/);
    assert.match(persist, /'nickeyTrailers'/);
    const syncBlock = ndsync.slice(ndsync.indexOf('const SYNC_KEYS'), ndsync.indexOf('const SYNC_KEY_SET'));
    assert.match(syncBlock, /nickeyTrailers/);
    assert.match(syncBlock, /nickeyCustomers/);
    assert.match(syncBlock, /nickeyContacts/);
    assert.match(syncBlock, /nickeyCustomSDS/);
  });

  it('shared load/save delegates to NickeyPersist writeMasterList / loadMasterList', () => {
    assert.match(shared, /persistMasterWrite\('nickeyCustomers'/);
    assert.match(shared, /persistMasterWrite\('nickeyTrailers'/);
    assert.match(shared, /persistMasterLoad\('nickeyCustomers'/);
    assert.match(shared, /persistMasterLoad\('nickeyTrailers'/);
    assert.match(shared, /writeMasterList/);
    assert.match(shared, /loadMasterList/);
  });

  it('bumps visible app version and service worker cache together', () => {
    assert.match(html, /V 8\.8/);
    assert.match(sw, /CACHE_VERSION = 'nickey-v8\.8'/);
  });

  it('round-trips a new customer and trailer through shared helpers + persist', () => {
    const store = {};
    const sandbox = {
      window: {},
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      },
      console,
      document: undefined,
      indexedDB: undefined
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(persist, sandbox, { filename: 'nickey-persist.js' });
    vm.runInContext(shared, sandbox, { filename: 'nickey-shared.js' });

    const customers = sandbox.ndLoadCustomers();
    customers.push({ name: 'Test Shipper Co', pay: 100, limit: 0, address: '' });
    assert.equal(sandbox.ndSaveCustomers(customers), true);

    const trailers = sandbox.ndLoadTrailers();
    trailers.push('SD TEST');
    assert.equal(sandbox.ndSaveTrailers(trailers), true);

    delete sandbox.customers;
    const reloadedCust = sandbox.ndLoadCustomers();
    const reloadedTrail = sandbox.ndLoadTrailers();
    assert.ok(reloadedCust.some((c) => c.name === 'Test Shipper Co'));
    assert.ok(reloadedTrail.includes('SD TEST'));
    assert.ok(store.nickeyCustomers);
    assert.ok(store.nickeyTrailers);
    assert.match(store.nickeyCustomers, /Test Shipper Co/);
    assert.match(store.nickeyTrailers, /SD TEST/);
  });
});
