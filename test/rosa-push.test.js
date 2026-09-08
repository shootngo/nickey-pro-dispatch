'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rosa = require('../nickey-rosa-push.js');

describe('payWeekOf — Sun–Sat week of tripDate', () => {
  it('returns the Sunday for a mid-week date', () => {
    // Tuesday 8 Sep 2026 → Sunday 6 Sep 2026
    assert.equal(rosa.payWeekOf('2026-09-08'), '2026-09-06');
  });
  it('keeps Sunday as the week start', () => {
    assert.equal(rosa.payWeekOf('2026-09-06'), '2026-09-06');
  });
  it('maps Saturday back to that week’s Sunday', () => {
    assert.equal(rosa.payWeekOf('2026-09-12'), '2026-09-06');
  });
  it('returns empty string for a missing date', () => {
    assert.equal(rosa.payWeekOf(''), '');
    assert.equal(rosa.payWeekOf(null), '');
  });
});

describe('milesFromOdo / costPerMile', () => {
  it('computes out minus in', () => {
    assert.equal(rosa.milesFromOdo(100000, 100482.4), 482.4);
  });
  it('returns 0 when out is before in or either is missing', () => {
    assert.equal(rosa.milesFromOdo(200, 100), 0);
    assert.equal(rosa.milesFromOdo('', 50), 0);
    assert.equal(rosa.milesFromOdo(50, ''), 0);
  });
  it('matches Pay Analyzer: basePay ÷ miles, 2 decimal dollars', () => {
    assert.equal(rosa.costPerMile(2256, 800), 2.82);
    assert.equal(rosa.costPerMile(800, 0), 0);
  });
});

describe('detentionCharge', () => {
  it('is free at or under 2 hours', () => {
    assert.equal(rosa.detentionCharge('2026-09-08', '08:00', '2026-09-08', '10:00'), 0);
    assert.equal(rosa.detentionCharge('2026-09-08', '08:00', '2026-09-08', '09:30'), 0);
  });
  it('bills $75/hr after 2 hours', () => {
    assert.equal(rosa.detentionCharge('2026-09-08', '08:00', '2026-09-08', '11:00'), 75);
    assert.equal(rosa.detentionCharge('2026-09-08', '08:00', '2026-09-08', '12:30'), 187.5);
  });
  it('returns 0 when times are incomplete', () => {
    assert.equal(rosa.detentionCharge('2026-09-08', '08:00', '', ''), 0);
  });
});

describe('classifyReimbursements', () => {
  it('splits reefer fuel from other extra pay', () => {
    const r = rosa.classifyReimbursements([
      { desc: 'Reefer fuel', amt: 85.5 },
      { desc: 'scale ticket', amount: 15 },
      { desc: 'lights', amt: 10 }
    ]);
    assert.equal(r.estReeferFuel, 85.5);
    assert.equal(r.estExtraPay, 25);
  });
  it('is zero when nothing is logged', () => {
    assert.deepEqual(rosa.classifyReimbursements([]), { estReeferFuel: 0, estExtraPay: 0 });
  });
});

describe('dest / origin / shipper mapping', () => {
  it('parses city and full state from a customer name', () => {
    assert.equal(
      rosa.destCityFromCustomer('Hydrox Elgin Illinois', ''),
      'Elgin, IL'
    );
    assert.equal(
      rosa.destCityFromCustomer('Harrison Produce Bethlehem Georgia', ''),
      'Bethlehem, GA'
    );
    assert.equal(
      rosa.destCityFromCustomer('Mountaire Siler City North Carolina', ''),
      'Siler City, NC'
    );
  });
  it('prefers a City, ST in the customer address', () => {
    assert.equal(
      rosa.destCityFromCustomer('Maxson', '500 Industrial Rd, Memphis, TN'),
      'Memphis, TN'
    );
  });
  it('reads Shipper: from notes', () => {
    assert.equal(rosa.shipperFromNotes('Shipper: Evonik — extra pumps'), 'Evonik');
  });
  it('uses a notes City, ST as origin when it differs from dest', () => {
    assert.equal(
      rosa.originCityFromNotes('Dillon, SC — Friday 9am', 'Elgin, IL'),
      'Dillon, SC'
    );
    assert.equal(
      rosa.originCityFromNotes('Elgin, IL plant', 'Elgin, IL'),
      ''
    );
  });
});

describe('buildTripDoc', () => {
  const sample = {
    id: 'REC-1',
    date: '2026-09-08',
    pickup: '3012 874535',
    customer: 'Hydrox Elgin Illinois',
    basePay: 2256,
    odometerIn: 100000,
    odometerOut: 100800,
    notes: 'Shipper: Evonik Dillon — Dillon, SC plant',
    arrivalDate: '2026-09-08',
    arrivalTime: '08:00',
    departureDate: '2026-09-08',
    departureTime: '12:00',
    reimbursements: [
      { desc: 'Reefer fuel', amount: 40 },
      { desc: 'scales', amt: 12 }
    ],
    trailer: 'SD 94',
    driverName: 'Frank Mulkey'
  };

  it('maps Frank-side estimate fields and Frank notes', () => {
    const doc = rosa.buildTripDoc(sample, '2026-09-08T18:00:00.000Z');
    assert.equal(doc.tripDate, '2026-09-08');
    assert.equal(doc.payWeek, '2026-09-06');
    assert.equal(doc.pushedAt, '2026-09-08T18:00:00.000Z');
    assert.equal(doc.pickup, '3012874535');
    assert.equal(doc.consignee, 'Hydrox Elgin Illinois');
    assert.equal(doc.destCity, 'Elgin, IL');
    assert.equal(doc.shipper, 'Evonik Dillon');
    assert.equal(doc.originCity, 'Dillon, SC');
    assert.equal(doc.estLinehaul, 2256);
    assert.equal(doc.estDetention, 150);
    assert.equal(doc.estReeferFuel, 40);
    assert.equal(doc.estExtraPay, 12);
    assert.equal(doc.odometerIn, 100000);
    assert.equal(doc.odometerOut, 100800);
    assert.equal(doc.miles, 800);
    assert.equal(doc.costPerMile, 2.82);
    assert.equal(doc.notes.length, 1);
    assert.equal(doc.notes[0].author, 'Frank');
    assert.match(doc.notes[0].text, /Shipper: Evonik/);
    assert.equal(doc.notes[0].timestamp, '2026-09-08T18:00:00.000Z');
  });

  it('omits Rosa actuals / deductions so merge cannot wipe them', () => {
    const doc = rosa.buildTripDoc(sample, '2026-09-08T18:00:00.000Z');
    assert.equal('actLinehaul' in doc, false);
    assert.equal('actDetention' in doc, false);
    assert.equal('deductions' in doc, false);
    assert.equal(doc.estLinehaul != null, true);
  });

  it('zeros unclear extras and skips empty notes', () => {
    const doc = rosa.buildTripDoc({
      date: '2026-09-08',
      pickup: '1',
      customer: 'WSC',
      basePay: 200,
      notes: '   '
    }, '2026-09-08T18:00:00.000Z');
    assert.equal(doc.estDetention, 0);
    assert.equal(doc.estExtraPay, 0);
    assert.equal(doc.estReeferFuel, 0);
    assert.equal(doc.miles, 0);
    assert.equal(doc.costPerMile, 0);
    assert.deepEqual(doc.notes, []);
  });
});

describe('parseConfigPaste', () => {
  it('accepts a firebaseConfig JS snippet', () => {
    const cfg = rosa.parseConfigPaste(
      'const firebaseConfig = {\n' +
      '  apiKey: "AIzaSyTest",\n' +
      '  authDomain: "rosa.firebaseapp.com",\n' +
      '  projectId: "rosa-ledger",\n' +
      '};'
    );
    assert.equal(cfg.apiKey, 'AIzaSyTest');
    assert.equal(cfg.projectId, 'rosa-ledger');
  });
  it('accepts strict JSON', () => {
    const cfg = rosa.parseConfigPaste('{"apiKey":"k","projectId":"p"}');
    assert.equal(cfg.apiKey, 'k');
  });
});

describe('isPlaceholderConfig', () => {
  it('treats the shipped placeholder as not ready', () => {
    assert.equal(rosa.isPlaceholderConfig(rosa.PLACEHOLDER_CONFIG), true);
    assert.equal(rosa.isPlaceholderConfig({ apiKey: 'AIzaReal', projectId: 'rosa' }), false);
  });
});

describe('pushTrip merge id', () => {
  it('uses pickup digits as the document id', () => {
    const doc = rosa.buildTripDoc({ pickup: '3012-874535', date: '2026-09-08', basePay: 1 });
    assert.equal(rosa.tripDocId(doc), '3012874535');
  });

  it('writes with merge:true so Rosa actuals survive a re-push', async () => {
    const calls = [];
    const fakeDb = {
      collection: function (name) {
        assert.equal(name, 'trips');
        return {
          doc: function (id) {
            return {
              set: function (payload, opts) {
                calls.push({ id: id, payload: payload, opts: opts });
                return Promise.resolve();
              }
            };
          }
        };
      }
    };
    const doc = rosa.buildTripDoc({ pickup: '555', date: '2026-09-08', basePay: 10, notes: 'ok' }, '2026-09-08T00:00:00.000Z');
    const id = await rosa.pushTrip(doc, fakeDb);
    assert.equal(id, '555');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].opts, { merge: true });
    assert.equal(calls[0].payload.estLinehaul, 10);
    assert.equal('actLinehaul' in calls[0].payload, false);
  });
});
