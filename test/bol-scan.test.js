'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bol = require('../nickey-bol-scan.js');

describe('BOL field schema', () => {
  it('includes pickup #, product, weight, shipper, consignee, dates, trailer', () => {
    const keys = bol.BOL_FIELDS.map((f) => f.key);
    assert.ok(keys.includes('pickupNumber'));
    assert.ok(keys.includes('product'));
    assert.ok(keys.includes('tankerWeight'));
    assert.ok(keys.includes('shipper'));
    assert.ok(keys.includes('consignee'));
    assert.ok(keys.includes('pickupDate'));
    assert.ok(keys.includes('trailerNumber'));
  });

  it('maps pickup, date, weight, customer, trailer, notes onto form ids', () => {
    assert.equal(bol.fieldByKey('pickupNumber').formId, 'pki');
    assert.equal(bol.fieldByKey('pickupDate').formId, 'td');
    assert.equal(bol.fieldByKey('tankerWeight').formId, 'tw');
    assert.equal(bol.fieldByKey('consignee').formId, 'customerSelect');
    assert.equal(bol.fieldByKey('trailerNumber').formId, 'tki');
    assert.equal(bol.fieldByKey('notes').formId, 'nts');
    assert.equal(bol.fieldByKey('product').formId, null);
    assert.equal(bol.fieldByKey('shipper').notesPrefix, 'Shipper');
  });
});

describe('pickupMismatch', () => {
  it('is false when typed pickup is empty', () => {
    assert.equal(bol.pickupMismatch('', '3012874535'), false);
    assert.equal(bol.pickupMismatch('   ', '3012874535'), false);
  });
  it('ignores spaces and punctuation', () => {
    assert.equal(bol.pickupMismatch('3012 874535', '3012874535'), false);
    assert.equal(bol.pickupMismatch('3012-874535', '3012 874535'), false);
  });
  it('is true when digits differ', () => {
    assert.equal(bol.pickupMismatch('1112223334', '3012874535'), true);
  });
});

describe('normalizeDate / normalizeWeight', () => {
  it('accepts ISO and US dates', () => {
    assert.equal(bol.normalizeDate('2026-09-08'), '2026-09-08');
    assert.equal(bol.normalizeDate('09/08/2026'), '2026-09-08');
    assert.equal(bol.normalizeDate('9-8-26'), '2026-09-08');
    assert.equal(bol.normalizeDate('09.08.26'), '2026-09-08');
    assert.equal(bol.normalizeDate('not a date'), '');
  });
  it('strips lbs and commas from tanker weight', () => {
    assert.equal(bol.normalizeWeight('45,200 lbs'), '45200');
    assert.equal(bol.normalizeWeight('45200'), '45200');
    assert.equal(bol.normalizeWeight(''), '');
    assert.equal(bol.normalizeWeight('n/a'), '');
  });
});

describe('parseBolJson', () => {
  it('fills the schema and accepts aliases (customer, trailer, weight)', () => {
    const f = bol.parseBolJson(JSON.stringify({
      pickupNumber: '3012 874535',
      pickupDate: '09/08/2026',
      product: 'Super D 500',
      weight: '45,200 lb',
      shipper: 'Evonik Dillon',
      customer: 'Hydrox Elgin Illinois',
      trailer: 'SD 94',
      originCity: 'Dillon, SC',
      destCity: 'Elgin, IL',
      notes: 'Keep upright'
    }));
    assert.equal(f.pickupNumber, '3012874535');
    assert.equal(f.pickupDate, '2026-09-08');
    assert.equal(f.product, 'Super D 500');
    assert.equal(f.tankerWeight, '45200');
    assert.equal(f.consignee, 'Hydrox Elgin Illinois');
    assert.equal(f.trailerNumber, 'SD 94');
    assert.equal(f.shipper, 'Evonik Dillon');
  });

  it('strips markdown fences and leaves unknown fields empty', () => {
    const f = bol.parseBolJson('```json\n{"pickupNumber":"555"}\n```');
    assert.equal(f.pickupNumber, '555');
    assert.equal(f.product, '');
  });

  it('throws on garbage so the UI can ask for a retake', () => {
    assert.throws(() => bol.parseBolJson('not json'), /malformed JSON/);
  });
});

describe('composeNotes', () => {
  it('prepends Product / Shipper / Origin / Dest without duplicating', () => {
    const notes = bol.composeNotes('', {
      product: 'Vigorox WWT II',
      shipper: 'Evonik',
      originCity: 'Dillon, SC',
      destCity: 'Elgin, IL',
      notes: 'Keep upright'
    });
    assert.match(notes, /Product: Vigorox WWT II/);
    assert.match(notes, /Shipper: Evonik/);
    assert.match(notes, /Origin: Dillon, SC/);
    assert.match(notes, /Dest: Elgin, IL/);
    assert.match(notes, /Keep upright/);
  });

  it('keeps existing notes and skips duplicates', () => {
    const notes = bol.composeNotes('Shipper: Evonik\nCall dock', {
      product: 'Spectrum 22',
      shipper: 'Evonik',
      notes: 'Call dock'
    });
    assert.match(notes, /Product: Spectrum 22/);
    assert.equal((notes.match(/Shipper: Evonik/g) || []).length, 1);
    assert.equal((notes.match(/Call dock/g) || []).length, 1);
  });
});

describe('matchCustomer / matchTrailer', () => {
  const customers = [
    { name: 'Hydrox Elgin Illinois' },
    { name: 'Mountaire Siler City' }
  ];
  it('matches a consignee onto a known customer', () => {
    const m = bol.matchCustomer('HYDROX LABORATORIES ELGIN', customers);
    assert.equal(m.name, 'Hydrox Elgin Illinois');
  });
  it('matches trailer numbers by inclusion', () => {
    assert.equal(bol.matchTrailer('94', ['SD 94', 'SD 45']), 'SD 94');
    assert.equal(bol.matchTrailer('ISO 144930', ['SD 94', 'ISO 144930']), 'ISO 144930');
    assert.equal(bol.matchTrailer('nope', ['SD 94']), '');
  });
});

describe('zoom support', () => {
  it('uses hardware zoom when MediaTrackCapabilities.zoom is a range', () => {
    const z = bol.resolveZoomSupport({ zoom: { min: 1, max: 8, step: 0.1 } });
    assert.equal(z.mode, 'hardware');
    assert.equal(z.max, 8);
    assert.equal(bol.clampZoom(z, 99), 8);
    assert.equal(bol.clampZoom(z, 0), 1);
  });
  it('falls back to CSS scale when zoom is not advertised', () => {
    const z = bol.resolveZoomSupport({});
    assert.equal(z.mode, 'css');
    assert.equal(z.max, 3);
  });
});

describe('Gemini prompt is tunable and names the real fields', () => {
  it('asks for pickup, product, weight, shipper, consignee, trailer', () => {
    const p = bol.bolGeminiPrompt();
    assert.match(p, /pickupNumber/);
    assert.match(p, /product/);
    assert.match(p, /tankerWeight/);
    assert.match(p, /shipper/);
    assert.match(p, /consignee/);
    assert.match(p, /trailerNumber/);
  });
});

describe('extractBolFromImage calls Gemini multimodal (not a Lens SDK)', () => {
  it('posts inline image data to generativelanguage.googleapis.com', async () => {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            pickupNumber: '3012874535',
            product: 'Super D 500',
            tankerWeight: '45200'
          }) }] } }]
        })
      };
    };
    const fields = await bol.extractBolFromImage('abc123', 'image/jpeg', 'test-key', fakeFetch);
    assert.equal(fields.pickupNumber, '3012874535');
    assert.equal(fields.product, 'Super D 500');
    assert.equal(fields.tankerWeight, '45200');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
    assert.match(calls[0].url, /gemini-2\.5-flash/);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
    assert.equal(body.contents[0].parts[1].inlineData.data, 'abc123');
  });

  it('surfaces the shared missing-key message', async () => {
    await assert.rejects(
      () => bol.extractBolFromImage('x', 'image/jpeg', '', async () => ({})),
      /Gemini API key not set/
    );
  });
});

describe('review HTML highlights a pickup mismatch', () => {
  it('mentions both numbers when they differ', () => {
    const html = bol.renderReviewHtml(
      { pickupNumber: '3012874535', product: 'Vigorox' },
      '1112223334'
    );
    assert.match(html, /does not match/);
    assert.match(html, /3012874535/);
    assert.match(html, /1112223334/);
    assert.match(html, /data-bol-key="product"/);
  });
  it('omits the mismatch banner when typed pickup is empty', () => {
    const html = bol.renderReviewHtml({ pickupNumber: '3012874535' }, '');
    assert.doesNotMatch(html, /does not match/);
  });
});
