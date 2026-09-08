'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bol = require('../nickey-bol-scan.js');

describe('BOL field schema', () => {
  it('includes pickup #, product, net weight, shipper, consignee, Evonik IDs', () => {
    const keys = bol.BOL_FIELDS.map((f) => f.key);
    ['pickupNumber', 'product', 'tankerWeight', 'shipper', 'consignee', 'pickupDate',
      'hazmat', 'shipmentNumber', 'materialNo', 'batch', 'customerMaterialNo',
      'containerId', 'seals', 'grossWeight', 'tareWeight'].forEach((k) => {
      assert.ok(keys.includes(k), 'missing ' + k);
    });
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
    assert.equal(bol.normalizeDate('Sep 8, 2026'), '2026-09-08');
    assert.equal(bol.normalizeDate('Sep 4, 2026'), '2026-09-04');
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

/** Golden example — Evonik Short Form ORIGINAL (Delivery no. 3012865610 → VI-JON). */
const EVONIK_SHORT_FORM = {
  deliveryNumber: '3012865610',
  pickupNumber: '4007091890',
  shipmentNumber: '4007091890',
  orderNumber: '2007702185',
  poNumber: '4500629294',
  pickupDate: 'Sep 8, 2026',
  deliveryDate: 'Sep 9, 2026',
  product: 'PERSYNT® 500 Super D BULK',
  hazmat: 'UN 2014, Hydrogen peroxide, aqueous solutions, 5.1 (8), II',
  hmFlag: 'X',
  tankerWeight: '43,120 LB',
  grossWeight: '74,240 LB',
  tareWeight: '31,120 LB',
  shipper: 'Evonik Corporation',
  consignee: 'VI-JON, INC.',
  originCity: 'Memphis, TN',
  destCity: 'Smyrna, TN',
  containerId: '77',
  seals: '1564889-1564888-1564887',
  materialNo: '99147256',
  batch: '1782681310',
  customerMaterialNo: '40000000200',
  notes: 'Protect from thermal radiation. COA MUST BE WITH SHIPMENT.'
};

describe('Evonik Short Form golden example', () => {
  it('uses Delivery no. as pickup, never Shipment no.', () => {
    const f = bol.parseBolJson(JSON.stringify(EVONIK_SHORT_FORM));
    assert.equal(f.pickupNumber, '3012865610');
    assert.equal(f.shipmentNumber, '4007091890');
    assert.notEqual(f.pickupNumber, f.shipmentNumber);
    assert.equal(f.orderNumber, '2007702185');
    assert.equal(f.poNumber, '4500629294');
  });

  it('maps Net LB to tanker weight, not Gross or Tare', () => {
    const f = bol.parseBolJson(JSON.stringify(EVONIK_SHORT_FORM));
    assert.equal(f.tankerWeight, '43120');
    assert.equal(f.grossWeight, '74240');
    assert.equal(f.tareWeight, '31120');
  });

  it('does not treat a shipment-only pickup as the Nickey pickup #', () => {
    const f = bol.parseBolJson(JSON.stringify({
      pickupNumber: '4007091890',
      shipmentNumber: '4007091890'
    }));
    assert.equal(f.pickupNumber, '');
    assert.equal(f.shipmentNumber, '4007091890');
  });

  it('prefers netWeight over a generic weight that equals gross', () => {
    const f = bol.parseBolJson(JSON.stringify({
      deliveryNumber: '3012865610',
      netWeight: '43120',
      weight: '74240',
      grossWeight: '74240'
    }));
    assert.equal(f.tankerWeight, '43120');
  });

  it('fills ship date, product, UN, IDs, shipper, ship-to, Cont. ID, seals', () => {
    const f = bol.parseBolJson(JSON.stringify(EVONIK_SHORT_FORM));
    assert.equal(f.pickupDate, '2026-09-08');
    assert.equal(f.deliveryDate, '2026-09-09');
    assert.match(f.product, /PERSYNT/);
    assert.match(f.product, /Super D/);
    assert.match(f.hazmat, /UN 2014/);
    assert.equal(f.hmFlag, 'X');
    assert.match(f.shipper, /Evonik/);
    assert.match(f.consignee, /VI-JON/i);
    assert.equal(f.originCity, 'Memphis, TN');
    assert.equal(f.destCity, 'Smyrna, TN');
    assert.equal(f.containerId, '77');
    assert.equal(f.seals, '1564889-1564888-1564887');
    assert.equal(f.materialNo, '99147256');
    assert.equal(f.batch, '1782681310');
    assert.equal(f.customerMaterialNo, '40000000200');
    assert.match(f.notes, /COA MUST BE WITH SHIPMENT/);
  });

  it('Apply patch: pickup, net weight, VIJON customer, notes with product/UN/IDs', () => {
    const customers = [
      { name: 'Hydrox Elgin Illinois' },
      { name: 'V.I.J.O.N. Smyrna Tennessee', limit: 5000, pay: 948 }
    ];
    const f = bol.parseBolJson(JSON.stringify(EVONIK_SHORT_FORM));
    const patch = bol.formPatchFromBol(f, customers, '');
    assert.equal(patch.pickupNumber, '3012865610');
    assert.equal(patch.pickupDate, '2026-09-08');
    assert.equal(patch.tankerWeight, '43120');
    assert.equal(patch.customer, 'V.I.J.O.N. Smyrna Tennessee');
    assert.match(patch.notes, /Product:.*PERSYNT/);
    assert.match(patch.notes, /Hazmat:.*UN 2014/);
    assert.match(patch.notes, /Material no\.: 99147256/);
    assert.match(patch.notes, /Batch: 1782681310/);
    assert.match(patch.notes, /Customer material no\.: 40000000200/);
    assert.match(patch.notes, /Shipment no\.: 4007091890/);
    assert.match(patch.notes, /Order no\.: 2007702185/);
    assert.match(patch.notes, /PO no\.: 4500629294/);
    assert.match(patch.notes, /Cont\. ID: 77/);
    assert.match(patch.notes, /Seals:/);
    assert.match(patch.notes, /COA MUST BE WITH SHIPMENT/);
    assert.doesNotMatch(patch.notes, /Pickup/);
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
    { name: 'Mountaire Siler City' },
    { name: 'V.I.J.O.N. Smyrna Tennessee' }
  ];
  it('matches a consignee onto a known customer', () => {
    const m = bol.matchCustomer('HYDROX LABORATORIES ELGIN', customers);
    assert.equal(m.name, 'Hydrox Elgin Illinois');
  });
  it('folds VI-JON, INC. onto V.I.J.O.N. Smyrna Tennessee', () => {
    const m = bol.matchCustomer('VI-JON, INC.', customers, 'Smyrna, TN');
    assert.equal(m.name, 'V.I.J.O.N. Smyrna Tennessee');
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
  it('asks for Delivery no. as pickup and Net LB as tanker weight', () => {
    const p = bol.bolGeminiPrompt();
    assert.match(p, /deliveryNumber/);
    assert.match(p, /Delivery no/);
    assert.match(p, /Shipment no/);
    assert.match(p, /tankerWeight/);
    assert.match(p, /NET/);
    assert.match(p, /consignee/);
    assert.match(p, /PERSYNT/);
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
    assert.match(html, /Delivery no/);
    assert.match(html, /data-bol-key="hazmat"/);
    assert.match(html, /data-bol-key="shipmentNumber"/);
  });
  it('omits the mismatch banner when typed pickup is empty', () => {
    const html = bol.renderReviewHtml({ pickupNumber: '3012874535' }, '');
    assert.doesNotMatch(html, /does not match/);
  });
});
