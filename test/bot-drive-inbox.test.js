'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const inbox = require('../nickey-bot-drive-inbox.js');

const EXAMPLE = {
  pickup: '3012874535',
  basePay: 4385,
  notes: 'Dillon SC Friday 9am — dispatcher Daniel Kline',
  inboxStatus: 'pending',
  source: 'grok_bot'
};

describe('normalizePickup', () => {
  it('strips non-digits', () => {
    assert.equal(inbox.normalizePickup('PU# 3012-874-535'), '3012874535');
  });
});

describe('isPending', () => {
  it('treats missing status as pending', () => {
    assert.equal(inbox.isPending({ pickup: '1' }), true);
  });
  it('skips acked trips', () => {
    assert.equal(inbox.isPending({ pickup: '1', inboxStatus: 'acked' }), false);
  });
});

describe('applyInboxToRecords — example trip 3012874535', () => {
  it('adds a new saveRecord-shaped trip', () => {
    const result = inbox.applyInboxToRecords([], [EXAMPLE], 'Frank');
    assert.equal(result.added, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.records.length, 1);
    const rec = result.records[0];
    assert.equal(rec.pickup, '3012874535');
    assert.equal(rec.basePay, 4385);
    assert.match(rec.notes, /Dillon SC Friday 9am/);
    assert.equal(rec.source, 'grok_bot');
    assert.equal(rec.driverName, 'Frank');
    assert.deepEqual(rec.fuelEntries, []);
    assert.equal(rec.bookkeepingComplete, false);
  });

  it('is idempotent by pickup digits', () => {
    const first = inbox.applyInboxToRecords([], [EXAMPLE], 'Frank');
    const again = inbox.applyInboxToRecords(first.records, [
      { pickupNumber: '3012 874535', basePay: 4385, inboxStatus: 'pending', source: 'grok_bot' }
    ], 'Frank');
    assert.equal(again.added, 0);
    assert.equal(again.updated, 1);
    assert.equal(again.records.length, 1);
  });

  it('does not wipe fuel, reimbursements, or bookkeeping', () => {
    const existing = [{
      id: 'REC-1',
      pickup: '3012874535',
      basePay: 100,
      notes: 'on the truck',
      fuelEntries: [{ station: 'Pilot', amount: 400, gallons: 80 }],
      reimbursements: [{ desc: 'scale', amount: 15 }],
      actualPay: 4200,
      bookkeepingComplete: true
    }];
    const result = inbox.applyInboxToRecords(existing, [EXAMPLE], 'Frank');
    assert.equal(result.added, 0);
    const rec = result.records[0];
    assert.equal(rec.basePay, 100, 'existing pay kept when already set');
    assert.equal(rec.fuelEntries[0].station, 'Pilot');
    assert.equal(rec.reimbursements[0].amount, 15);
    assert.equal(rec.actualPay, 4200);
    assert.equal(rec.bookkeepingComplete, true);
    assert.match(rec.notes, /on the truck/);
    assert.match(rec.notes, /Dillon SC/);
  });

  it('fills empty dispatch fields on an existing stub', () => {
    const existing = [{ id: 'REC-1', pickup: '3012874535', basePay: 0, notes: '', fuelEntries: [] }];
    const result = inbox.applyInboxToRecords(existing, [EXAMPLE], 'Frank');
    assert.equal(result.added, 0);
    assert.equal(result.records[0].basePay, 4385);
    assert.match(result.records[0].notes, /Dillon SC/);
    assert.deepEqual(result.records[0].fuelEntries, []);
  });

  it('skips acked trips', () => {
    const result = inbox.applyInboxToRecords([], [
      { ...EXAMPLE, inboxStatus: 'acked' }
    ], 'Frank');
    assert.equal(result.added, 0);
    assert.equal(result.records.length, 0);
  });
});

describe('inbox write-back payload', () => {
  it('removes applied trips and keeps the rest', () => {
    const trips = [
      EXAMPLE,
      { pickup: '999', notes: 'still pending', inboxStatus: 'pending' }
    ];
    const applied = [EXAMPLE];
    const remaining = inbox.remainingInboxTrips(trips, applied);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].pickup, '999');
    const cleared = inbox.buildClearedInbox({ version: 1 }, remaining);
    assert.equal(cleared.version, 1);
    assert.ok(cleared.updatedAt);
    assert.equal(cleared.trips.length, 1);
  });

  it('rewrites an empty inbox when every trip was applied', () => {
    const remaining = inbox.remainingInboxTrips([EXAMPLE], [EXAMPLE]);
    const cleared = inbox.buildClearedInbox({ version: 1 }, remaining);
    assert.deepEqual(cleared.trips, []);
  });
});
