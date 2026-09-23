'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'site-observation.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inspection = fs.readFileSync(path.join(root, 'inspection.html'), 'utf8');
const intermodal = fs.readFileSync(path.join(root, 'intermodal.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

const PPE = [
  'Hard hat',
  'Safety Goggles',
  'Face Shield',
  'Steel toe / Rubber Boots/Gloves',
  'Chemical Suit',
  'Hearing Protection (if Appl)'
];
const OFFLOAD = [
  'Verify seals',
  'Paperwork Signed and Dated by Customer',
  'All PPE on',
  'Check Safety Shower / eye wash for Proper Operation',
  'Water hose',
  'Confirm with Customer Tank Level Acceptable for Full Load',
  'Access tank level (gauges /sight glass)',
  'Hydraulic Lines Connected (if appl)',
  'Gas operator power cord connected (if appl)',
  'Purge Fitting Hooked on Discharge of Trailer (if Appl)',
  'Daily Visual Inspection of each H2O2 Hose',
  'Ensure dike containment is dry, if not, obtain approval of safe conditions to access dike',
  'Hoses Connected and Secure',
  'All Drain Valves on Trailer/Tank Closed',
  'Sight glass valve open if loading into an ISO',
  'Dome Lid Open on Trailer',
  'Dip-leg Valve Open on Trailer',
  'Secondary Suction Valve Closed',
  'Trailer Discharge Valve Open (If appl)',
  'Customer Tank Valve Open'
];
const HOUSE = [
  'Area free of combustibles (paper, wood, grass)',
  'Safety Shower /Eye Wash',
  'Water hose available',
  'Adequate lighting',
  'Work area free of slips or trip hazards',
  'Road conditions adequate to off-loading area',
  'Off-loading area free of obstacles',
  'Customer provided water for diluting',
  'Customer tank and valves clearly marked (accessible)'
];
const AFTER = [
  'Approval from Customer to Start Off-Load, sign off on shipping documents.',
  'Monitor tank level and area for leaks',
  'Trailer is Empty',
  'Shut down product pump',
  'Reconfirm All PPE still on!',
  'Close Discharge Valve/Start hose Purge/dip tube',
  'Hoses Are Completely Blown Out?',
  'Close purge valve',
  'Close Valve on Customer Tank',
  'Clean Bucket for Walking Out Hoses',
  'Open Drain to Relieve Pressure From Hose',
  'Drain Hoses in Clean Bucket',
  'Ask Customer for Proper Disposal Location',
  'Close All Trailer Valves, drains and Dome Lid',
  'Place ends on all hoses and store in hose tubes',
  'Wash Down Area If Needed'
];

describe('Evonik site observation checklist', () => {
  it('is on the hamburger menu and the inspection form-link row', () => {
    assert.match(index, /href="site-observation\.html" class="menu-item">📋 Site Observation Checklist/);
    assert.match(inspection, /href="site-observation\.html">Site Observation/);
    assert.match(intermodal, /href="site-observation\.html">Site Observation/);
    assert.match(page, /class="form-link active" href="site-observation\.html">Site Observation/);
  });

  it('is precached with the app shell', () => {
    assert.match(sw, /'\.\/site-observation\.html'/);
  });

  it('keeps the printed sheet wording', () => {
    assert.match(page, /Evonik Customer Site Observation Checklist/);
    assert.match(page, />EVONIK</);
    assert.match(page, />INDUSTRIES</);
    assert.match(page, /Driver Name:/);
    assert.match(page, /Customer Location:/);
    assert.match(page, /Carrier:/);
    assert.match(page, /Trailer #/);
    assert.match(page, /Product description:/);
    assert.match(page, /Delivery #:/);
    assert.match(page, /Pickup Information/);
    assert.match(page, /Delivery Information/);
    assert.match(page, /Arrival Time:/);
    assert.match(page, /Depart Time:/);
    for (const label of PPE.concat(OFFLOAD, HOUSE, AFTER)) {
      assert.ok(page.includes(label), label);
    }
    assert.match(page, /Driver Personal Protective Equipment/);
    assert.match(page, /Off-Loading Checklist/);
    assert.match(page, /Work Conditions and Housekeeping/);
    assert.match(page, />Safe</);
    assert.match(page, />Concerns</);
    assert.match(page, />Checked</);
    assert.match(page, /\[Internal\]/);
    assert.match(page, /1 \| Page/);
    assert.match(page, /2 \| Page/);
    assert.match(page, /Please email all non-conformance issues to , <a href="mailto:jim\.dollahan@evonik\.com">jim\.dollahan@evonik\.com<\/a> , <a href="mailto:Jacob-D\.Smith@evonik\.com">Jacob-D\.Smith@evonik\.com<\/a> , <a href="mailto:bruce\.eaton@evonik\.com">bruce\.eaton@evonik\.com<\/a>/);
    assert.match(page, /Comments:/);
  });

  it('emails the dispatcher a JPEG and keeps a local draft', () => {
    assert.match(page, /ndGetContactEmail\('dispatch', 'DKlein@nickeywarehouse\.com'\)/);
    assert.match(page, /mailto:' \+ dispatchEmail/);
    assert.match(page, /Site Observation Checklist — /);
    assert.match(page, /navigator\.share/);
    assert.match(page, /navigator\.canShare/);
    assert.match(page, /image\/jpeg/);
    assert.match(page, /site-observation-/);
    assert.match(page, /attach the downloaded JPEG/);
    assert.match(page, /so-export-host/);
    assert.match(page, /nickeySiteObservationDraft/);
    assert.match(page, /nickeyDispatchFormState/);
    assert.match(page, /currentDriver/);
    assert.match(page, /window\.print\(\)/);
  });

  it('does not attach voice input or show a microphone on this page', () => {
    assert.doesNotMatch(page, /ndAttachVoiceInput/);
    assert.doesNotMatch(page, /🎤/);
  });

  it('keeps site photos with the draft and attaches them beside the checklist JPEG', () => {
    assert.match(page, /Photos \(what's broken\)/);
    assert.match(page, />Take photo</);
    assert.match(page, />Add from gallery</);
    assert.match(page, /id="takePhotoInput" accept="image\/\*" capture="environment"/);
    assert.match(page, /id="addPhotoInput" accept="image\/\*" multiple/);
    assert.match(page, /PHOTO_LIMIT = 8/);
    assert.match(page, /indexedDB\.open\(PHOTO_DB/);
    assert.match(page, /nickey-site-photos/);
    assert.match(page, /maxEdge = 1600/);
    assert.match(page, /'image\/jpeg', 0\.75/);
    assert.match(page, /site-photo-/);
    assert.match(page, /querySelectorAll\('\.site-photos'\)/);
    assert.match(page, /photoCount/);
    const commentsAt = page.indexOf('id="comments"');
    const photosAt = page.indexOf('id="sitePhotos"');
    assert.ok(commentsAt > 0 && photosAt > commentsAt);
  });
});
