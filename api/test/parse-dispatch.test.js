import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDispatchText,
  parseDispatchTextFull,
  DANIEL_SMS_SAMPLE,
  DANIEL_SMS_ORIGINAL,
  mergeDispatch,
  emptyDispatch
} from '../src/parse-dispatch.js';

describe('heuristic parseDispatchText — Daniel Kline SMS', () => {
  it('parses the multiline success-criteria sample', () => {
    const d = parseDispatchText(DANIEL_SMS_SAMPLE);
    assert.equal(d.pickupNumber, '3012874535');
    assert.equal(d.basePay, 4385);
    assert.match(d.notes, /Dillon,\s*SC/i);
    assert.match(d.notes, /Friday at 9am/i);
    assert.equal(d.pickupDate, '');
    assert.equal(d.customer, '');
  });

  it('parses the original one-line Dillon / pu# RCS bubble', () => {
    const d = parseDispatchText(DANIEL_SMS_ORIGINAL);
    assert.equal(d.pickupNumber, '3012874535');
    assert.equal(d.basePay, 4385);
    assert.match(d.notes, /Dillon,\s*SC/i);
    assert.match(d.notes, /Friday at 9am/i);
  });

  it('accepts PU# without space and $ pay', () => {
    const d = parseDispatchText('PU#3012874535 pays you around $4,385.00');
    assert.equal(d.pickupNumber, '3012874535');
    assert.equal(d.basePay, 4385);
  });

  it('reads ISO date, customer label, trailer, high limit', () => {
    const d = parseDispatchText(
      'Customer: Hydrox Elgin Illinois\n' +
      'pickup # 1112223334\n' +
      '2026-09-04\n' +
      'trailer SD 94\n' +
      'high limit 5400\n' +
      'pay: 2256'
    );
    assert.equal(d.pickupNumber, '1112223334');
    assert.equal(d.pickupDate, '2026-09-04');
    assert.equal(d.customer, 'Hydrox Elgin Illinois');
    assert.equal(d.trailerNumber, 'SD 94');
    assert.equal(d.highLimit, 5400);
    assert.equal(d.basePay, 2256);
  });

  it('does not invent a customer from an origin city', () => {
    const d = parseDispatchText(DANIEL_SMS_SAMPLE);
    assert.equal(d.customer, '');
  });
});

describe('mergeDispatch + parseDispatchTextFull', () => {
  it('fills empty heuristic fields from Gemini-shaped JSON', () => {
    const h = parseDispatchText(DANIEL_SMS_SAMPLE);
    const merged = mergeDispatch(h, {
      customer: 'P.L. Developments Piedmont South Carolina',
      pickupDate: '2026-09-04'
    });
    assert.equal(merged.pickupNumber, '3012874535');
    assert.equal(merged.basePay, 4385);
    assert.equal(merged.customer, 'P.L. Developments Piedmont South Carolina');
    assert.equal(merged.pickupDate, '2026-09-04');
  });

  it('skips Gemini when no key is set', async () => {
    const r = await parseDispatchTextFull(DANIEL_SMS_SAMPLE, {});
    assert.equal(r.parser, 'heuristic');
    assert.equal(r.dispatch.pickupNumber, '3012874535');
    assert.equal(r.gemini, null);
  });

  it('starts from emptyDispatch', () => {
    const e = emptyDispatch();
    assert.equal(e.pickupNumber, '');
    assert.equal(e.basePay, null);
  });
});
