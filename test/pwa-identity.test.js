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
    assert.ok(srcs.includes('icon-maskable-512.png'));
    assert.ok(srcs.includes('apple-touch-icon.png'));
    assert.ok(!srcs.some((src) => src.includes('rosas-ledger')));
    for (const icon of nickey.icons) {
      assert.ok(exists(icon.src), icon.src);
    }
    const hasAny = nickey.icons.some((icon) => /\bany\b/.test(icon.purpose));
    const hasMaskable = nickey.icons.some((icon) => /\bmaskable\b/.test(icon.purpose));
    assert.ok(hasAny && hasMaskable);
    assert.ok(exists('favicon.ico'));
  });

  it('points Nickey HTML heads at Night run favicons', () => {
    for (const page of ['index.html', 'earnings.html', 'inspection.html', 'intermodal.html', 'sds.html']) {
      const html = read(page);
      assert.match(html, /rel="apple-touch-icon"[^>]*href="apple-touch-icon\.png"/);
      assert.match(html, /href="icon-192\.png"/);
      assert.match(html, /href="icon-512-2\.png"/);
      assert.match(html, /href="favicon\.ico"/);
      assert.doesNotMatch(html, /rel="apple-touch-icon" href="icon-512-2/);
    }
  });

  it('serves Night run PNGs at the declared sizes (not the old green trucks)', () => {
    const pngSize = (rel) => {
      const buf = fs.readFileSync(path.join(root, rel));
      assert.equal(buf[0], 0x89);
      assert.equal(buf.slice(1, 4).toString(), 'PNG');
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    };
    assert.deepEqual(pngSize('icon-192.png'), { w: 192, h: 192 });
    assert.deepEqual(pngSize('icon-512-2.png'), { w: 512, h: 512 });
    assert.deepEqual(pngSize('icon-maskable-512.png'), { w: 512, h: 512 });
    assert.deepEqual(pngSize('apple-touch-icon.png'), { w: 180, h: 180 });
    // Old green-truck assets were larger; Night run rasters must stay distinct.
    const old192 = 55053;
    const old512 = 287236;
    assert.notEqual(fs.statSync(path.join(root, 'icon-192.png')).size, old192);
    assert.notEqual(fs.statSync(path.join(root, 'icon-512-2.png')).size, old512);
  });
});

describe('service workers do not fight over /rosas-ledger/', () => {
  const nickeySw = read('sw.js');
  const rosaSw = read('rosas-ledger/sw.js');
  const rosaHtml = read('rosas-ledger/index.html');

  it('bumps Nickey cache when the manifest/icons change', () => {
    assert.match(nickeySw, /CACHE_VERSION = 'nickey-v8\.5'/);
    assert.match(nickeySw, /'\.\/icon-192\.png'/);
    assert.match(nickeySw, /'\.\/icon-512-2\.png'/);
    assert.match(nickeySw, /'\.\/icon-maskable-512\.png'/);
    assert.match(nickeySw, /'\.\/apple-touch-icon\.png'/);
    assert.match(nickeySw, /'\.\/favicon\.ico'/);
  });

  it('still precaches Nickey BOL scan after the PWA split', () => {
    assert.match(nickeySw, /'\.\/nickey-bol-scan\.js'/);
    assert.match(nickeySw, /'\.\/nickey-rosa-push\.js'/);
    assert.match(nickeySw, /'\.\/nickey-persist\.js'/);
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

describe('upgrade-safe persist is wired into the PWA shell', () => {
  it('loads persist before Drive sync so merges run on pull', () => {
    const html = read('index.html');
    const persistAt = html.indexOf('nickey-persist.js');
    const ndsyncAt = html.indexOf('ndsync.js');
    assert.ok(persistAt > 0);
    assert.ok(ndsyncAt > persistAt);
  });

  it('exposes Export / Import / Drive restore in the dispatch menu', () => {
    const html = read('index.html');
    assert.match(html, /exportNickeyBackup\(\)/);
    assert.match(html, /importNickeyBackup\(\)/);
    assert.match(html, /restoreNickeyDriveBackup\(\)/);
    assert.match(html, /Export backup/);
    assert.match(html, /Import backup/);
    assert.match(html, /Restore from Drive backup/);
  });
});

describe('Drive snapshots are append-only', () => {
  it('POSTs nickey-backup-* as new files and never PATCHes them', () => {
    const src = read('ndsync.js');
    assert.match(src, /BACKUP_PREFIX = 'nickey-backup-'/);
    assert.match(src, /uploadFile\(null, snap/);
    assert.match(src, /shouldWarnShrink/);
    assert.match(src, /pre-shrink/);
    assert.match(src, /confirmShrinkPush/);
    assert.doesNotMatch(src, /uploadFile\(driveFileId, snap/);
  });

  it('earnings import no longer replace-wipes saved records', () => {
    const html = read('earnings.html');
    assert.doesNotMatch(html, /This will REPLACE all current data/);
    assert.match(html, /importBackupFile|MERGES into current data/);
  });
});
