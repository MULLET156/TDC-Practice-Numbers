'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/periods');

test('this month compares with the same days last month and last year', () => {
  const r = P.resolveRange({}, '2026-11-17');
  assert.equal(r.key, 'mtd');
  assert.deepEqual([r.cur.from, r.cur.to], ['2026-11-01', '2026-11-17']);
  assert.deepEqual([r.prev.from, r.prev.to], ['2026-10-01', '2026-10-17']);
  assert.deepEqual([r.lastYear.from, r.lastYear.to], ['2025-11-01', '2025-11-17']);
});

test('the 31st compares with the end of a shorter month', () => {
  const r = P.resolveRange({ range: 'mtd' }, '2026-03-31');
  assert.deepEqual([r.prev.from, r.prev.to], ['2026-02-01', '2026-02-28']);
});

test('last month, quarter, year to date', () => {
  const lm = P.resolveRange({ range: 'lm' }, '2026-01-10');
  assert.deepEqual([lm.cur.from, lm.cur.to, lm.prev.from, lm.prev.to], ['2025-12-01', '2025-12-31', '2025-11-01', '2025-11-30']);
  assert.deepEqual([lm.lastYear.from, lm.lastYear.to], ['2024-12-01', '2024-12-31']);
  const q = P.resolveRange({ range: 'qtd' }, '2026-11-17');
  assert.deepEqual([q.cur.from, q.prev.from, q.prev.to], ['2026-10-01', '2026-07-01', '2026-08-17']);
  const y = P.resolveRange({ range: 'ytd' }, '2028-02-29');
  assert.deepEqual([y.cur.from, y.prev.from, y.prev.to], ['2028-01-01', '2027-01-01', '2027-02-28']);
  assert.equal(y.lastYear, null, 'year to date already compares with last year');
});

test('custom ranges: swapped dates, the period before, bad input falls back', () => {
  const c = P.resolveRange({ range: 'custom', from: '2026-11-10', to: '2026-11-01' }, '2026-11-17');
  assert.deepEqual([c.cur.from, c.cur.to, c.prev.from, c.prev.to], ['2026-11-01', '2026-11-10', '2026-10-22', '2026-10-31']);
  assert.equal(P.resolveRange({ range: 'custom', from: '2026-02-30', to: 'x' }, '2026-11-17').key, 'mtd');
  assert.equal(P.resolveRange({ range: 'nope' }, '2026-11-17').key, 'mtd');
  assert.equal(P.rangeQuery(c), '?range=custom&from=2026-11-01&to=2026-11-10');
});

test('13 months end today; long ranges are bucketed', () => {
  const m = P.trendMonths('2026-11-17');
  assert.equal(m.length, 13);
  assert.equal(m[0].from, '2025-11-01');
  assert.equal(m[12].to, '2026-11-17');
  assert.equal(P.buckets('2026-11-01', '2026-11-17').length, 17);
  assert.equal(P.buckets('2026-01-01', '2026-11-17')[0].unit, 'week');
  assert.equal(P.buckets('2024-01-01', '2026-11-17')[0].unit, 'month');
});

test('time zone: late evening in Oregon is still that day', () => {
  assert.equal(P.todayIn('America/Los_Angeles', new Date('2026-11-18T06:30:00Z')), '2026-11-17');
});
