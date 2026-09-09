'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Pickup Number trailing actions (mic + BOL camera)', () => {
  const html = read('index.html');
  const sharedJs = read('nickey-shared.js');
  const sharedCss = read('nickey-shared.css');
  const sw = read('sw.js');

  it('keeps the BOL camera on the pickup field as a trailing action', () => {
    const fieldStart = html.indexOf('id="pkField"');
    const fieldEnd = html.indexOf('id="pkd"');
    const chunk = html.slice(fieldStart, fieldEnd);
    assert.ok(fieldStart > 0, 'pk-field wrapper missing');
    assert.match(chunk, /id="pki"/);
    assert.match(chunk, /id="pkTrailing"/);
    assert.match(chunk, /id="bolScanBtn"/);
    assert.match(chunk, /openBolScanner\(\)/);
    assert.match(chunk, /aria-label="Scan BOL with camera"/);
    assert.ok(chunk.indexOf('id="pki"') < chunk.indexOf('id="bolScanBtn"'));
  });

  it('does not use the old pk-row width:auto rule that floated the mic mid-field', () => {
    assert.doesNotMatch(html, /pk-row #pki/);
    assert.doesNotMatch(html, /\.pk-row\s*\{/);
    assert.match(html, /\.pk-field #pki\{[^}]*width:100%/);
    assert.match(html, /\.pk-trailing\{[^}]*position:absolute/);
    assert.match(html, /\.pk-trailing\{[^}]*right:6px/);
  });

  it('injects the pickup mic into the trailing cluster instead of wrapping #pki', () => {
    assert.match(sharedJs, /trailingHost/);
    assert.match(sharedJs, /nd-mic-in-trailing/);
    assert.match(sharedCss, /\.nd-mic-in-trailing/);
    assert.match(html, /ndAttachVoiceInput\('pki',\s*\{\s*numericOnly:\s*true,\s*trailingHost:\s*'pkTrailing'\s*\}\)/);
    assert.doesNotMatch(html, /\['pki'/);
  });

  it('still opens Gemini BOL scan, review, apply, and persist', () => {
    assert.match(html, /function openBolScanner\(/);
    assert.match(html, /function applyBolToForm\(/);
    assert.match(html, /id="bolScanOverlay"/);
    assert.match(html, /id="bolReviewOverlay"/);
    assert.match(html, /persistTripFromCurrentForm\(\{\s*source:\s*'bol-scan'/);
    assert.match(html, /nickey-bol-scan\.js/);
  });

  it('bumps the Nickey service worker so phones pick up the layout', () => {
    assert.match(sw, /CACHE_VERSION = 'nickey-v8\.4'/);
    assert.match(html, /V 8\.4/);
  });
});
