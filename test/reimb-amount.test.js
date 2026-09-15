'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Reimbursement amount fields are phone-sized', () => {
  const html = read('index.html');

  it('marks description and amount so CSS can enlarge only the $ input', () => {
    assert.match(html, /class="fld reimb-desc"/);
    assert.match(html, /class="fld reimb-amt"/);
    assert.match(html, /class="reimb-amt-input"/);
    assert.match(html, /class="reimb-remove"/);
    assert.match(html, /inputmode="decimal"/);
  });

  it('gives the amount input a larger font and taller tap target', () => {
    assert.match(html, /\.reimb-row \.reimb-amt input\{[^}]*font-size:28px/);
    assert.match(html, /\.reimb-row \.reimb-amt input\{[^}]*min-height:58px/);
    assert.match(html, /\.reimb-row \.reimb-amt input\{[^}]*font-weight:700/);
  });

  it('gives the amount column more width than the old 2fr 1fr split', () => {
    assert.doesNotMatch(html, /\.reimb-row\{[^}]*grid-template-columns:2fr 1fr auto/);
    assert.match(html, /\.reimb-row\{[^}]*minmax\(9\.75rem,1\.2fr\)/);
  });

  it('stacks amount under description on a phone so $55.00 is not squeezed', () => {
    assert.match(html, /@media \(max-width:520px\)/);
    assert.match(html, /grid-template-areas:"desc desc" "amt remove"/);
    assert.match(html, /\.reimb-row \.reimb-amt input\{font-size:32px;min-height:64px/);
  });

  it('still collects amount from number inputs in each reimb row', () => {
    assert.match(html, /#reimbContainer \.reimb-row/);
    assert.match(html, /row\.querySelector\('input\[type="number"\]'\)/);
    assert.match(html, /#reimbContainer input\[type="number"\]/);
  });
});
