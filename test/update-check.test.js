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

function el(id) {
  const node = {
    id: id || '',
    style: { cssText: '', display: 'none' },
    textContent: '',
    parentNode: null,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      const list = this.listeners[type] || [];
      this.listeners[type] = list.filter((h) => h !== fn);
    },
    click() {
      (this.listeners.click || []).forEach((fn) => fn());
    }
  };
  return node;
}

function loadShared(overrides) {
  const store = {};
  const bodyKids = [];
  const nodes = {
    menuOverlay: el('menuOverlay')
  };
  nodes.menuOverlay.style.display = 'flex';

  const document = {
    body: {
      appendChild(child) {
        child.parentNode = this;
        bodyKids.push(child);
      },
      removeChild(child) {
        const idx = bodyKids.indexOf(child);
        if (idx >= 0) bodyKids.splice(idx, 1);
        child.parentNode = null;
      }
    },
    getElementById(id) {
      if (nodes[id]) return nodes[id];
      return bodyKids.find((n) => n.id === id) || null;
    },
    createElement(tag) {
      const node = el('');
      node.tagName = String(tag).toUpperCase();
      return node;
    }
  };

  const messages = [];
  const alerts = [];
  const confirms = [];
  const reloads = { count: 0 };
  const fetchCalls = [];
  let waiting = overrides.waiting !== undefined ? overrides.waiting : null;
  let installing = overrides.installing !== undefined ? overrides.installing : null;
  const controller = overrides.controller !== undefined ? overrides.controller : { postMessage(msg) { messages.push({ from: 'controller', msg }); } };

  const updateListeners = [];
  const swListeners = {};

  const registration = {
    waiting,
    installing,
    update: overrides.update || (async () => registration),
    addEventListener(type, fn) {
      if (type === 'updatefound') updateListeners.push(fn);
    }
  };

  const sandbox = {
    window: {},
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    console,
    document,
    alert: (msg) => { alerts.push(String(msg)); },
    confirm: (msg) => {
      confirms.push(String(msg));
      return overrides.confirm === undefined ? true : !!overrides.confirm;
    },
    fetch: async (url, opts) => {
      fetchCalls.push({ url, opts });
      if (overrides.fetch === 'fail') throw new Error('offline');
      return { ok: overrides.fetchOk !== false };
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    navigator: {
      serviceWorker: overrides.noSw ? undefined : {
        controller,
        getRegistration: async () => (overrides.noReg ? null : registration),
        register: async () => registration,
        addEventListener(type, fn) {
          swListeners[type] = swListeners[type] || [];
          swListeners[type].push(fn);
        }
      }
    },
    location: { reload() { reloads.count += 1; } }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.toggleMenu = function () {
    nodes.menuOverlay.style.display = nodes.menuOverlay.style.display === 'flex' ? 'none' : 'flex';
  };

  vm.createContext(sandbox);
  vm.runInContext(read('nickey-shared.js'), sandbox, { filename: 'nickey-shared.js' });
  sandbox.ND_SW_CHECK_SETTLE_MS = 0;
  sandbox.ND_SW_RELOAD_MS = 20;

  return {
    sandbox,
    registration,
    nodes,
    bodyKids,
    messages,
    alerts,
    confirms,
    reloads,
    fetchCalls,
    updateListeners,
    swListeners
  };
}

describe('hamburger Check for update', () => {
  const html = read('index.html');
  const shared = read('nickey-shared.js');
  const sw = read('sw.js');

  it('adds a Check for update item next to Settings and wires ndCheckForUpdate', () => {
    assert.match(html, /onclick="openSettings\(\)"[\s\S]*onclick="ndCheckForUpdate\(\)"/);
    assert.match(html, /🔄 Check for update/);
    assert.match(shared, /w\.ndCheckForUpdate\s*=\s*function/);
    assert.match(shared, /ND_APP_VERSION = 'V 9\.5'/);
  });

  it('keeps the passive New version available banner', () => {
    assert.match(shared, /New version available — tap to update/);
    assert.match(shared, /ndShowUpdateBanner/);
    assert.match(shared, /ndWatchServiceWorker/);
    assert.match(html, /ndWatchServiceWorker\(reg\)/);
    assert.match(html, /updateViaCache:\s*'none'/);
  });

  it('bumps visible version and SW cache to 9.5 together', () => {
    assert.match(html, /<title>Nickey Professional Dispatch V 9\.5</);
    assert.match(html, /splash-version">V 9\.5</);
    assert.match(html, /NICKEY DISPATCH <span[^>]*>V 9\.5</);
    assert.match(html, /Sent from Nickey Dispatch V 9\.5/);
    assert.match(sw, /CACHE_VERSION = 'nickey-v9\.5'/);
    assert.doesNotMatch(html, /V 9\.4/);
    assert.doesNotMatch(sw, /nickey-v9\.4/);
  });

  it('activates a waiting worker by posting SKIP_WAITING to it, not only the controller', () => {
    const posted = [];
    const waiting = { state: 'installed', postMessage(msg) { posted.push(msg); } };
    const ctx = loadShared({ waiting, confirm: true });
    const result = ctx.sandbox.ndActivateWaitingWorker(ctx.registration);
    assert.equal(result, 'activating');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, 'SKIP_WAITING');
    assert.equal(ctx.messages.length, 0);
  });

  it('reports already latest with the current version when no new SW is waiting', async () => {
    const ctx = loadShared({ waiting: null, installing: null });
    const result = await ctx.sandbox.ndCheckForUpdate();
    assert.equal(result, 'latest');
    assert.equal(ctx.alerts.length, 1);
    assert.match(ctx.alerts[0], /V 9\.5/);
    assert.match(ctx.alerts[0], /already latest/);
    assert.equal(ctx.nodes.menuOverlay.style.display, 'none');
    assert.ok(ctx.fetchCalls.some((c) => String(c.url).indexOf('sw.js?check=') !== -1));
    assert.equal(ctx.fetchCalls[0].opts.cache, 'no-store');
  });

  it('confirms then activates when a newer worker is already waiting', async () => {
    const posted = [];
    const waiting = { state: 'installed', postMessage(msg) { posted.push(msg); } };
    const ctx = loadShared({ waiting, confirm: true });
    const result = await ctx.sandbox.ndCheckForUpdate();
    assert.equal(result, 'updating');
    assert.equal(ctx.confirms.length, 1);
    assert.match(ctx.confirms[0], /New version found/);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, 'SKIP_WAITING');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(ctx.reloads.count >= 1);
  });

  it('shows the existing update banner if the driver declines the reload confirm', async () => {
    const posted = [];
    const waiting = { state: 'installed', postMessage(msg) { posted.push(msg); } };
    const ctx = loadShared({ waiting, confirm: false });
    const result = await ctx.sandbox.ndCheckForUpdate();
    assert.equal(result, 'deferred');
    assert.equal(posted.length, 0);
    const banner = ctx.bodyKids.find((n) => n.id === 'ndUpdateBanner');
    assert.ok(banner);
    assert.match(banner.textContent, /New version available/);
  });

  it('says it could not check when the network ping and update both fail', async () => {
    const ctx = loadShared({
      waiting: null,
      installing: null,
      fetch: 'fail',
      update: async () => { throw new Error('update failed'); }
    });
    const result = await ctx.sandbox.ndCheckForUpdate();
    assert.equal(result, 'offline');
    assert.equal(ctx.alerts.length, 1);
    assert.match(ctx.alerts[0], /Couldn't check for an update/);
    assert.match(ctx.alerts[0], /V 9\.5/);
  });
});
