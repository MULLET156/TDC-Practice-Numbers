'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { start, NAMES } = require('./helpers');

test('health needs no signature; everything else does', async () => {
  const s = await start();
  try {
    const h = await s.req('/health', { sign: false });
    assert.equal(h.status, 200);
    assert.deepEqual(h.json, { ok: true, version: require('../package.json').version, contract: 1 });
    assert.equal((await s.req('/', { sign: false })).status, 401);
    assert.equal((await s.req('/manifest.json', { sign: false })).status, 401);
    assert.equal((await s.req('/', { time: Date.now() - 60000 })).status, 401);
  } finally { await s.close(); }
});

test('manifest follows CONTRACT §4', async () => {
  const s = await start();
  try {
    const m = (await s.req('/manifest.json', { roles: 'system' })).json;
    assert.equal(m.id, 'numbers'); assert.equal(m.contract, 1); assert.equal(m.icon, 'chart');
    assert.deepEqual(m.roles, ['owner', 'admin']);
    assert.ok(m.tiles.some((t) => t.id === 'production-mtd'));
  } finally { await s.close(); }
});

test('owner and admin only', async () => {
  const s = await start();
  try {
    for (const r of ['doctor', 'hygienist', 'assistant', 'front']) {
      assert.equal((await s.req('/', { roles: r })).status, 403);
      assert.equal((await s.req('/tiles/production-mtd', { roles: r })).status, 403);
      assert.equal((await s.req('/api/list/families', { roles: r })).status, 403);
    }
    assert.equal((await s.req('/', { roles: 'admin' })).status, 200);
  } finally { await s.close(); }
});

test('every page renders with the shared look, no inline scripts, and no patients', async () => {
  const s = await start();
  try {
    for (const p of ['/', '/production', '/collections', '/ar', '/?range=ytd', '/production?range=custom&from=2026-01-01&to=2026-03-31', '/ar?range=lm']) {
      const r = await s.req(p);
      assert.equal(r.status, 200, p);
      assert.match(r.text, /<link rel="stylesheet" href="\/shared\/tdc\.css">/);
      assert.match(r.text, /<body data-module="numbers"/);
      assert.doesNotMatch(r.text, /<script>(?!<\/script>)|<script(?![^>]*\bsrc=)[^>]*>[^<]/, 'no inline scripts');
      assert.doesNotMatch(r.text, /\son[a-z]+=/i, 'no inline handlers');
      assert.doesNotMatch(r.text, /NaN|undefined|Infinity/, `${p} has no broken numbers`);
      for (const [l, f] of NAMES) { assert.ok(!r.text.includes(l) && !r.text.includes(f), `${p} names no patient`); }
      assert.equal(r.headers['cache-control'], 'no-store');
    }
    const g = await s.req('/');
    assert.match(g.text, /Gross production/);
    assert.match(g.text, /<svg class="pn-svg"/);
    assert.match(g.text, /data-tone="good"|data-tone="bad"/, 'arrows with tone');
  } finally { await s.close(); }
});

test('reports the gateway lacks say "Not available yet" and show no number', async () => {
  const s = await start({ missing: ['patient_payments_by_provider', 'insurance_payments_by_provider', 'ar_aging_totals'] });
  try {
    const c = await s.req('/collections');
    assert.equal(c.status, 200);
    assert.match(c.text, /Some numbers aren&#39;t here yet|Some numbers aren't here yet/);
    assert.match(c.text, /Not available yet/);
    const a = await s.req('/ar');
    assert.match(a.text, /Total A\/R<\/h3><p class="pn-kpi-value pn-na">Not available yet/);
  } finally { await s.close(); }
});

test('the tile: Production MTD against last month to date', async () => {
  const s = await start();
  try {
    const t = (await s.req('/tiles/production-mtd')).json;
    assert.equal(t.title, 'Production MTD');
    assert.match(t.value, /^\$[\d,]+$/);
    assert.ok(['ok', 'warn', 'alert'].includes(t.status));
    assert.ok(t.items.length <= 8);
    for (const i of t.items) assert.ok(i.href.startsWith('/') && !i.href.startsWith('//'));
    assert.ok(t.items.some((i) => /Last month to date/.test(i.text)));
  } finally { await s.close(); }
});

test('a slow gateway: the tile still answers in time', async () => {
  const client = require('./helpers').fakeClient();
  const slow = client.runReport;
  client.runReport = (n, p) => new Promise((r) => setTimeout(() => r(slow(n, p)), 500));
  const s = await start({ client, tileTimeoutMs: 100 });
  try {
    const t0 = Date.now();
    const t = (await s.req('/tiles/production-mtd')).json;
    assert.ok(Date.now() - t0 < 450);
    assert.equal(t.value, 'Loading…');
  } finally { await s.close(); }
});

test('design stage: stops when the gateway is not in the design stage', async () => {
  const s = await start({ stage: 'live' });
  try {
    await s.app.checkGateway();
    const r = await s.req('/');
    assert.equal(r.status, 503);
    assert.match(r.text, /Numbers are paused/);
    assert.equal((await s.req('/api/list/families')).status, 503);
    assert.equal((await s.req('/tiles/production-mtd')).json.value, 'Paused');
    assert.equal((await s.req('/health', { sign: false })).status, 200, 'health still answers');
  } finally { await s.close(); }
});

test('design stage: stops when the gateway is unreachable', async () => {
  const s = await start({ down: true });
  try {
    await s.app.checkGateway();
    assert.equal((await s.req('/production')).status, 503);
  } finally { await s.close(); }
});

test('patient lists: only on request, not cached, and never logged', async () => {
  const s = await start();
  try {
    const f = await s.req('/api/list/families');
    assert.equal(f.status, 200);
    assert.equal(f.headers['cache-control'], 'no-store');
    assert.equal(f.json.rows.length, 2);
    assert.equal(f.json.rows[0].name, `${NAMES[0][0]}, ${NAMES[0][1]}`);
    const before = s.client.calls.filter((c) => c[0] === 'ar_aging').length;
    await s.req('/api/list/families');
    assert.equal(s.client.calls.filter((c) => c[0] === 'ar_aging').length, before + 1, 'asked the gateway again (not cached)');
    assert.equal((await s.req('/api/list/outstanding')).json.rows.length, 2);
    assert.equal((await s.req('/api/list/unsent')).json.rows.length, 1);
    assert.equal((await s.req('/api/list/nope')).status, 404);
    const logs = s.logs.join('\n');
    for (const [l, f2] of NAMES) assert.ok(!logs.includes(l) && !logs.includes(f2), 'no names in logs');
    for (const line of s.logs) { const j = JSON.parse(line); if (j.path) assert.ok(!j.path.includes('?')); }
  } finally { await s.close(); }
});

test('patient lists can be turned off', async () => {
  const s = await start({ lists: false });
  try {
    assert.equal((await s.req('/api/list/families')).status, 404);
    assert.doesNotMatch((await s.req('/ar')).text, /data-list="families"/);
  } finally { await s.close(); }
});

test('only GET', async () => {
  const s = await start();
  try { assert.equal((await s.req('/', { method: 'POST' })).status, 405); } finally { await s.close(); }
});

test('nothing from Open Dental is written to disk', async () => {
  const root = path.join(__dirname, '..');
  const list = () => fs.readdirSync(root, { recursive: true }).filter((f) => !String(f).startsWith('.git')).sort().join('\n');
  const before = list();
  const s = await start();
  try { for (const p of ['/', '/production', '/collections', '/ar', '/api/list/families']) await s.req(p); } finally { await s.close(); }
  assert.equal(list(), before);
});

test('vendored core/ files are unchanged (CONTRACT §7)', () => {
  const dir = path.join(__dirname, '..', 'vendor', 'opendental-core');
  const sums = fs.readFileSync(path.join(dir, 'CHECKSUMS'), 'utf8').trim().split(/\r?\n/);
  assert.ok(sums.length > 0);
  for (const line of sums) {
    const [hash, file] = line.split(/\s+/);
    const buf = fs.readFileSync(path.join(dir, file));
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), hash, `${file} was edited`);
  }
});
