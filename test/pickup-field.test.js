'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

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
    assert.match(html, /\.pk-field\{[^}]*display:flex/);
    assert.match(html, /\.pk-trailing\{[^}]*flex-shrink:0/);
    assert.match(html, /\.pk-trailing\{[^}]*margin-left:auto/);
    assert.doesNotMatch(html, /\.pk-trailing\{[^}]*position:absolute/);
    assert.match(html, /\.pk-trailing \.nd-mic-btn\{[^}]*position:static/);
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
    assert.match(sw, /CACHE_VERSION = 'nickey-v8\.6'/);
    assert.match(html, /V 8\.6/);
  });
});

function makeEl(tag, attrs) {
  attrs = attrs || {};
  const classSet = new Set(String(attrs.className || '').split(/\s+/).filter(Boolean));
  const el = {
    tagName: String(tag).toUpperCase(),
    id: attrs.id || '',
    children: [],
    parentNode: null,
    dataset: {},
    textContent: '',
    type: '',
    value: '',
    setAttribute: function (name, val) {
      if (name === 'class') this.className = val;
      if (name === 'aria-label') this['aria-label'] = val;
    },
    addEventListener: function () {},
    get firstChild() { return this.children[0] || null; },
    appendChild: function (child) {
      if (child.parentNode) {
        const arr = child.parentNode.children;
        const i = arr.indexOf(child);
        if (i >= 0) arr.splice(i, 1);
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore: function (child, ref) {
      if (child.parentNode) {
        const arr = child.parentNode.children;
        const i = arr.indexOf(child);
        if (i >= 0) arr.splice(i, 1);
      }
      child.parentNode = this;
      if (!ref) this.children.push(child);
      else {
        const i = this.children.indexOf(ref);
        this.children.splice(i < 0 ? this.children.length : i, 0, child);
      }
      return child;
    }
  };
  Object.defineProperty(el, 'className', {
    get: function () { return [...classSet].join(' '); },
    set: function (v) {
      classSet.clear();
      String(v || '').split(/\s+/).filter(Boolean).forEach(function (c) { classSet.add(c); });
    }
  });
  el.classList = {
    add: function () {
      for (const c of arguments) classSet.add(c);
    },
    contains: function (c) { return classSet.has(c); }
  };
  if (attrs.className) el.className = attrs.className;
  return el;
}

describe('ndAttachVoiceInput trailingHost', () => {
  it('inserts the mic into pkTrailing and leaves #pki unwrapped', () => {
    const pki = makeEl('input', { id: 'pki' });
    const trailing = makeEl('div', { id: 'pkTrailing' });
    const cam = makeEl('button', { id: 'bolScanBtn' });
    trailing.appendChild(cam);
    const field = makeEl('div', { id: 'pkField' });
    field.appendChild(pki);
    field.appendChild(trailing);
    const byId = { pki: pki, pkTrailing: trailing, pkField: field };

    function FakeSR() {}
    const sandbox = {
      window: null,
      document: {
        getElementById: function (id) { return byId[id] || null; },
        createElement: function (tag) { return makeEl(tag); }
      },
      localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
      console: console,
      SpeechRecognition: FakeSR
    };
    sandbox.window = sandbox;
    vm.runInNewContext(read('nickey-shared.js'), sandbox);
    sandbox.ndAttachVoiceInput('pki', { numericOnly: true, trailingHost: 'pkTrailing' });

    assert.equal(pki.parentNode, field);
    assert.equal(field.children[0], pki);
    assert.equal(field.children[1], trailing);
    assert.equal(trailing.children.length, 2);
    assert.equal(trailing.children[0].textContent, '🎤');
    assert.ok(trailing.children[0].classList.contains('nd-mic-btn'));
    assert.ok(trailing.children[0].classList.contains('nd-mic-in-trailing'));
    assert.equal(trailing.children[1], cam);
    assert.equal(field.children.filter(function (c) {
      return c.classList.contains('nd-voice-wrap');
    }).length, 0);
  });
});
