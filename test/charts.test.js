'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { columnChart, barChart, figure } = require('../lib/charts');
const { delta, moneyShort, money } = require('../lib/fmt');

test('charts print their values (no hover needed) and never break on empty data', () => {
  const s = [{ name: 'Gross production', cls: 'pn-s1' }];
  const svg = columnChart({ items: [{ label: 'Oct', values: [3200] }, { label: 'Nov', values: [1500] }], series: s });
  assert.match(svg, />\$3\.2k</); assert.match(svg, />\$1\.5k</);
  for (const out of [columnChart({ items: [], series: s }), barChart({ items: [], series: s }), columnChart({ items: [{ label: 'x', values: [0] }], series: s })]) {
    assert.doesNotMatch(out, /NaN|Infinity|undefined/);
  }
  const f = figure({ id: 'x', title: 'T', wide: svg, table: '<table></table>' });
  assert.match(f, /data-view="table"/);
});

test('arrows: up is good for production, bad for write-offs', () => {
  assert.equal(delta(110, 100).tone, 'good');
  assert.equal(delta(110, 100, false).tone, 'bad');
  assert.equal(delta(100, 100).dir, 'flat');
  assert.equal(delta(null, 100).dir, 'none');
  assert.equal(delta(5, 0).pct, null);
  assert.equal(moneyShort(1234567), '$1.23M');
  assert.equal(money(-1234.4), '-$1,234');
});
