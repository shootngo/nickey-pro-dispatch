'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

describe('Nickey and Rosa PWA identities stay distinct', () => {
  const nickey = readJson('manifest.json');
  const rosa = readJson('rosas-ledger/manifest.json');

  it('uses different manifest ids so Chrome/Android do not merge the apps', () => {
    assert.ok(nickey.id, 'Nickey manifest needs an id');
    assert.ok(rosa.id, 'Rosa manifest needs an id');
    assert.notEqual(nickey.id, rosa.id);
    assert.match(nickey.id, /pwa=nickey/);
    assert.match(rosa.id, /rosas-ledger/);
    assert.match(rosa.id, /pwa=rosa/);
  });

  it('names each app for the home screen', () => {
    assert.match(nickey.name, /Nickey/);
    assert.match(nickey.short_name, /Nickey/);
    assert.equal(rosa.name, "Rosa's Ledger");
    assert.match(rosa.short_name, /Rosa/);
    assert.notEqual(nickey.name, rosa.name);
    assert.notEqual(nickey.short_name, rosa.short_name);
  });

  it('keeps Nickey start_url on the dispatch app, not Rosa', () => {
    assert.ok(nickey.start_url);
    assert.doesNotMatch(nickey.start_url, /rosas-ledger/);
    assert.equal(rosa.start_url, './index.html');
    assert.equal(rosa.scope, './');
  });

  it('points Rosa icons at the rose + eighteen-wheeler assets', () => {
    const srcs = rosa.icons.map((icon) => icon.src);
    assert.ok(srcs.includes('assets/icon-192.png'));
    assert.ok(srcs.includes('assets/icon-512.png'));
    assert.ok(srcs.includes('assets/icon-maskable-512.png'));
    for (const icon of rosa.icons) {
      assert.ok(exists(path.join('rosas-ledger', icon.src)), icon.src);
    }
    const hasAny = rosa.icons.some((icon) => /\bany\b/.test(icon.purpose));
    const hasMaskable = rosa.icons.some((icon) => /\bmaskable\b/.test(icon.purpose));
    assert.ok(hasAny && hasMaskable);
  });

  it('keeps Nickey truck icons (not Rosa art)', () => {
    const srcs = nickey.icons.map((icon) => icon.src);
    assert.ok(srcs.includes('icon-192.png'));
    assert.ok(srcs.includes('icon-512-2.png'));
    assert.ok(!srcs.some((src) => src.includes('rosas-ledger')));
    for (const icon of nickey.icons) {
      assert.ok(exists(icon.src), icon.src);
    }
  });
});

describe('service workers do not fight over /rosas-ledger/', () => {
  const nickeySw = read('sw.js');
  const rosaSw = read('rosas-ledger/sw.js');
  const rosaHtml = read('rosas-ledger/index.html');

  it('bumps Nickey cache when the manifest/icons change', () => {
    assert.match(nickeySw, /CACHE_VERSION = 'nickey-v8\.2k'/);
  });

  it('still precaches Nickey BOL scan after the PWA split', () => {
    assert.match(nickeySw, /'\.\/nickey-bol-scan\.js'/);
    assert.match(nickeySw, /'\.\/nickey-rosa-push\.js'/);
  });

  it('lets Rosa requests fall through Nickey SW without cache', () => {
    assert.match(nickeySw, /\/rosas-ledger\//);
    const fetchFn = nickeySw.slice(nickeySw.indexOf("self.addEventListener('fetch'"));
    const bypass = fetchFn.slice(0, fetchFn.indexOf('NETWORK_ONLY_ORIGINS'));
    assert.match(bypass, /indexOf\('\/rosas-ledger\/'\)/);
    assert.doesNotMatch(bypass, /respondWith/);
  });

  it('registers a Rosa SW scoped to this folder', () => {
    assert.match(rosaSw, /CACHE_VERSION = 'rosa-v1'/);
    assert.match(rosaHtml, /serviceWorker\.register\('\.\/sw\.js'/);
    assert.match(rosaHtml, /scope:\s*'\.\/'/);
    assert.match(rosaHtml, /rel="manifest"/);
  });
});
