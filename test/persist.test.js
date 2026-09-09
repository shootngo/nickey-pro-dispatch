'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../nickey-persist.js');

function rec(partial) {
  return Object.assign({
    pickup: '111',
    date: '2026-09-01',
    customer: 'Hydrox',
    basePay: 100,
    timestamp: '2026-09-01T10:00:00.000Z'
  }, partial);
}

describe('migrateRecord — older v8 shapes', () => {
  it('promotes fuel → fuelEntries, pickupNumber → pickup, and assigns an id', () => {
    const out = P.migrateRecord({
      pickupNumber: '3012-874-535',
      pickupDate: '2026-09-08',
      trailerNumber: 'SD 94',
      fuel: { station: 'Pilot', amount: 40 },
      timestamp: '2026-09-08T12:00:00.000Z'
    });
    assert.equal(out.pickup, '3012-874-535');
    assert.equal(out.date, '2026-09-08');
    assert.equal(out.trailer, 'SD 94');
    assert.equal(out.fuelEntries[0].station, 'Pilot');
    assert.equal(out.id, 'REC-2026-09-08T12:00:00.000Z');
    assert.equal(out.bookkeepingComplete, false);
    assert.equal(out.actualPay, null);
  });
});

describe('loadRecords — upgrade-safe migration', () => {
  it('reads a legacy key (nickeyDraftLoad) and writes nickeySavedRecords', () => {
    const store = P.memoryStorage({
      nickeyDraftLoad: JSON.stringify({
        pickupNumber: '9990001111',
        pickupDate: '2026-01-15',
        customer: 'Maxson'
      })
    });
    const loaded = P.loadRecords({ storage: store });
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.records[0].pickup, '9990001111');
    assert.equal(loaded.migrated, true);
    const canonical = JSON.parse(store.getItem('nickeySavedRecords'));
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].pickup, '9990001111');
  });

  it('recovers from a corrupt canonical key using .bak', () => {
    const good = [rec({ id: 'REC-bak', pickup: '222' })];
    const store = P.memoryStorage({
      nickeySavedRecords: '{not-json',
      'nickeySavedRecords.bak': JSON.stringify(good)
    });
    const loaded = P.loadRecords({ storage: store });
    assert.equal(loaded.parseFailed, true);
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.records[0].id, 'REC-bak');
    assert.equal(JSON.parse(store.getItem('nickeySavedRecords')).length, 1);
  });
});

describe('writeRecords — refuse silent wipe', () => {
  it('does not overwrite existing trips with an empty list', () => {
    const store = P.memoryStorage({
      nickeySavedRecords: JSON.stringify([rec({ id: 'REC-keep' })])
    });
    const wr = P.writeRecords([], { storage: store });
    assert.equal(wr.ok, true);
    assert.equal(JSON.parse(store.getItem('nickeySavedRecords')).length, 1);
    assert.equal(JSON.parse(store.getItem('nickeySavedRecords'))[0].id, 'REC-keep');
  });

  it('unions a stale in-memory list with newer disk trips', () => {
    const store = P.memoryStorage({
      nickeySavedRecords: JSON.stringify([
        rec({ id: 'REC-disk', pickup: '111' }),
        rec({ id: 'REC-other', pickup: '222' })
      ])
    });
    const wr = P.writeRecords([rec({ id: 'REC-mem', pickup: '333' })], { storage: store });
    assert.equal(wr.ok, true);
    assert.equal(wr.records.length, 3);
  });

  it('surfaces QuotaExceededError instead of swallowing it', () => {
    const store = P.memoryStorage();
    store.setItem = function () {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    };
    const wr = P.writeRecords([rec({ id: 'REC-q' })], { storage: store });
    assert.equal(wr.ok, false);
    assert.match(wr.error, /Storage is full/);
  });
});

describe('mergeRecordLists — Drive last-write-wins must not wipe', () => {
  it('unions a newer 1-trip local list with an older 2-trip remote list', () => {
    const local = [rec({ id: 'REC-new', pickup: '333', updatedAt: '2026-09-09T12:00:00.000Z' })];
    const remote = [
      rec({ id: 'REC-a', pickup: '111', updatedAt: '2026-08-01T00:00:00.000Z' }),
      rec({ id: 'REC-b', pickup: '222', updatedAt: '2026-08-02T00:00:00.000Z' })
    ];
    const merged = P.mergeRecordLists(local, remote);
    assert.equal(merged.length, 3);
    assert.ok(merged.some((r) => r.id === 'REC-new'));
    assert.ok(merged.some((r) => r.id === 'REC-a'));
    assert.ok(merged.some((r) => r.id === 'REC-b'));
  });

  it('keeps fuel and pay when the same pickup is updated', () => {
    const local = [rec({
      id: 'REC-1',
      pickup: '3012874535',
      fuelEntries: [{ station: 'Pilot', amount: 50 }],
      actualPay: 4000,
      updatedAt: '2026-09-08T10:00:00.000Z'
    })];
    const remote = [rec({
      id: 'REC-1',
      pickup: '3012874535',
      notes: 'bot note',
      updatedAt: '2026-09-09T10:00:00.000Z'
    })];
    const merged = P.mergeRecordLists(local, remote);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].fuelEntries[0].station, 'Pilot');
    assert.equal(merged[0].actualPay, 4000);
    assert.match(merged[0].notes, /bot note/);
  });
});

describe('mergeSyncKey — nickeySavedRecords', () => {
  it('does not apply a newer remote array that would drop local trips', () => {
    const local = JSON.stringify([
      rec({ id: 'REC-old-1', pickup: '111', updatedAt: '2026-08-01T00:00:00.000Z' }),
      rec({ id: 'REC-old-2', pickup: '222', updatedAt: '2026-08-01T00:00:00.000Z' })
    ]);
    const remote = JSON.stringify([
      rec({ id: 'REC-new', pickup: '333', updatedAt: '2026-09-09T00:00:00.000Z' })
    ]);
    const out = P.mergeSyncKey(
      'nickeySavedRecords',
      local,
      '2026-08-01T00:00:00.000Z',
      remote,
      '2026-09-09T00:00:00.000Z'
    );
    const records = JSON.parse(out.value);
    assert.equal(records.length, 3);
    assert.equal(out.changed, true);
  });

  it('last-write-wins still applies to scalar keys like currentDriver', () => {
    const out = P.mergeSyncKey(
      'currentDriver',
      'Frank Mulkey',
      '2026-08-01T00:00:00.000Z',
      'Other Driver',
      '2026-09-09T00:00:00.000Z'
    );
    assert.equal(out.value, 'Other Driver');
    assert.equal(out.changed, true);
  });
});

describe('tombstones', () => {
  it('deleteRecordAt removes the trip and does not resurrect it on merge', () => {
    const store = P.memoryStorage({
      nickeySavedRecords: JSON.stringify([
        rec({ id: 'REC-a', pickup: '111' }),
        rec({ id: 'REC-b', pickup: '222' })
      ])
    });
    const del = P.deleteRecordAt(0, { storage: store });
    assert.equal(del.ok, true);
    assert.equal(del.records.length, 1);
    assert.equal(del.records[0].id, 'REC-b');
    const remote = [rec({ id: 'REC-a', pickup: '111', updatedAt: '2026-01-01T00:00:00.000Z' })];
    const merged = P.mergeRecordLists(del.records, remote, P.loadTombstones(store));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'REC-b');
  });
});

describe('upsertRecord', () => {
  it('reloads existing trips before appending a new one', () => {
    const store = P.memoryStorage({
      nickeySavedRecords: JSON.stringify([rec({ id: 'REC-existing', pickup: '111' })])
    });
    const wr = P.upsertRecord(rec({ id: 'REC-new', pickup: '999' }), { storage: store });
    assert.equal(wr.ok, true);
    assert.equal(wr.records.length, 2);
  });
});

describe('service worker does not touch trip storage', () => {
  it('never clears localStorage / IndexedDB on cache bump', () => {
    const sw = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sw.js'), 'utf8');
    assert.doesNotMatch(sw, /localStorage\.(clear|removeItem)/);
    assert.doesNotMatch(sw, /indexedDB\.deleteDatabase/);
    assert.match(sw, /nickey-persist\.js/);
  });
});

describe('backup file names', () => {
  it('formats nickey-backup-YYYY-MM-DDTHHMMSSZ.json', () => {
    const name = P.backupFileName(new Date('2026-09-09T14:32:01.123Z'));
    assert.equal(name, 'nickey-backup-2026-09-09T143201123Z.json');
    assert.equal(P.isBackupFileName(name), true);
    assert.equal(P.isBackupFileName('nickey-dispatch-data.json'), false);
    assert.equal(P.isBackupFileName('nickey-backup-2026-09-09T143201Z.json'), true);
  });
});

describe('shouldWarnShrink', () => {
  it('warns when remote would drop by more than 10% or more than 5 trips', () => {
    assert.equal(P.shouldWarnShrink(23, 200), true);
    assert.equal(P.shouldWarnShrink(89, 100), true);
    assert.equal(P.shouldWarnShrink(96, 100), false);
    assert.equal(P.shouldWarnShrink(100, 100), false);
    assert.equal(P.shouldWarnShrink(200, 23), false);
    assert.equal(P.shouldWarnShrink(0, 0), false);
  });
});

describe('shouldOfferLocalRestore', () => {
  it('offers when local looks tiny compared with IndexedDB/.bak', () => {
    assert.equal(P.shouldOfferLocalRestore(23, 200), true);
    assert.equal(P.shouldOfferLocalRestore(0, 10), true);
    assert.equal(P.shouldOfferLocalRestore(50, 51), false);
  });
});

describe('selectSnapshotsToKeep — retention union', () => {
  it('keeps last 30 OR last 14 days OR the largest-ever snapshot', () => {
    const now = Date.parse('2026-09-09T12:00:00.000Z');
    const files = [];
    let i;
    for (i = 0; i < 5; i++) {
      files.push({
        id: 'old-' + i,
        name: P.backupFileName(new Date('2026-08-01T0' + i + ':00:00.000Z')),
        createdTime: '2026-08-01T0' + i + ':00:00.000Z',
        size: String(1000 + i),
        description: 'nickey-snapshot trips:' + (10 + i)
      });
    }
    files.push({
      id: 'largest-old',
      name: P.backupFileName(new Date('2026-08-01T12:00:00.000Z')),
      createdTime: '2026-08-01T12:00:00.000Z',
      size: '999999',
      description: 'nickey-snapshot trips:400'
    });
    for (i = 0; i < 10; i++) {
      files.push({
        id: 'new-' + i,
        name: P.backupFileName(new Date('2026-09-09T0' + i + ':00:00.000Z')),
        createdTime: '2026-09-09T0' + i + ':00:00.000Z',
        size: '2000',
        description: 'nickey-snapshot trips:50'
      });
    }
    const plan = P.selectSnapshotsToKeep(files, now, { maxCount: 5, maxAgeMs: 14 * 86400000 });
    const keepIds = plan.keep.map((f) => f.id);
    assert.ok(keepIds.includes('largest-old'), 'largest-ever snapshot must be kept');
    assert.equal(keepIds.filter((id) => id.startsWith('new-')).length, 10, 'all files from last 14 days kept');
    assert.ok(plan.trash.every((f) => f.id.startsWith('old-')), 'only small old files are trashed');
    assert.equal(plan.trash.length, 5);
  });
});

describe('countTripsInPayload', () => {
  it('reads Drive keys payload and export arrays', () => {
    const recs = [rec({ id: 'REC-1' }), rec({ id: 'REC-2', pickup: '222' })];
    assert.equal(P.countTripsInPayload({ nickeySavedRecords: recs }), 2);
    assert.equal(P.countTripsInPayload({
      keys: { nickeySavedRecords: { value: JSON.stringify(recs), updatedAt: 'x' } }
    }), 2);
  });
});

describe('export / import backup — merge-union, never replace-wipe', () => {
  it('recovers an empty canonical key from .bak', () => {
    const good = [rec({ id: 'REC-bak', pickup: '222' })];
    const store = P.memoryStorage({
      nickeySavedRecords: '[]',
      'nickeySavedRecords.bak': JSON.stringify(good)
    });
    const loaded = P.loadRecords({ storage: store });
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.records[0].id, 'REC-bak');
  });

  it('parses Drive snapshot files and earnings v2 exports', () => {
    const recs = [rec({ id: 'REC-d', pickup: '111' })];
    const drive = P.parseBackupFile({
      kind: 'nickey-snapshot',
      keys: {
        nickeySavedRecords: { value: JSON.stringify(recs), updatedAt: '2026-09-09T00:00:00.000Z' }
      }
    });
    assert.equal(drive.ok, true);
    assert.equal(drive.tripCount, 1);
    const v2 = P.parseBackupFile({
      version: 2,
      exportedAt: '2026-09-01T00:00:00.000Z',
      nickeySavedRecords: recs,
      weeklyDeductions: { '2026-W01': { ifta: 10 } }
    });
    assert.equal(v2.ok, true);
    assert.equal(v2.tripCount, 1);
    assert.ok(v2.keys.weeklyDeductions);
  });

  it('merges an imported backup into existing trips instead of replacing', () => {
    const store = P.memoryStorage({
      nickeySavedRecords: JSON.stringify([
        rec({ id: 'REC-local', pickup: '111' }),
        rec({ id: 'REC-keep', pickup: '222' })
      ])
    });
    const backup = {
      version: 3,
      kind: 'nickey-backup',
      exportedAt: '2026-09-09T00:00:00.000Z',
      nickeySavedRecords: [
        rec({ id: 'REC-backup', pickup: '333' }),
        rec({ id: 'REC-local', pickup: '111', notes: 'from backup', updatedAt: '2026-09-09T12:00:00.000Z' })
      ]
    };
    const wr = P.importBackupMerge(backup, { storage: store });
    assert.equal(wr.ok, true);
    assert.equal(wr.records.length, 3);
    assert.ok(wr.records.some((r) => r.id === 'REC-keep'));
    assert.ok(wr.records.some((r) => r.id === 'REC-backup'));
    const local = wr.records.find((r) => r.id === 'REC-local');
    assert.match(local.notes, /from backup/);
  });

  it('buildExportPayload includes saved records and related sync keys', () => {
    const store = P.memoryStorage({
      nickeySavedRecords: JSON.stringify([rec({ id: 'REC-x', pickup: '111' })]),
      weeklyDeductions: JSON.stringify({ '2026-W01': { ifta: 5 } }),
      currentDriver: 'Frank Mulkey'
    });
    const payload = P.buildExportPayload({ storage: store });
    assert.equal(payload.kind, 'nickey-backup');
    assert.equal(payload.tripCount, 1);
    assert.equal(payload.nickeySavedRecords[0].id, 'REC-x');
    assert.ok(payload.keys.weeklyDeductions);
    assert.equal(payload.currentDriver, 'Frank Mulkey');
  });
});

