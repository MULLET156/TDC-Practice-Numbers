'use strict';
// Practice Numbers: routes, the Dashboard signature check (CONTRACT §3), the
// owner/admin role check, the gateway stage guard (CONTRACT §1), the tile
// (§5), the manifest (§4), /health and request logs (§8).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { verifyTdcRequest, hasRole } = require('./tdc-verify');
const { checkStage } = require('../vendor/opendental-core/gateway-client');
const { createData } = require('./data');
const P = require('./periods');
const pages = require('./pages');
const { money, delta, pct } = require('./fmt');

const VERSION = require('../package.json').version;
const ROLES = ['owner', 'admin'];
const STAGE_CHECK_MS = 5 * 60 * 1000;

const MANIFEST = {
  contract: 1,
  id: 'numbers',
  name: 'Practice Numbers',
  version: VERSION,
  description: 'Production, collections, A/R and trends. Owner and admin only.',
  icon: 'chart',
  roles: ROLES,
  nav: pages.PAGES.map((p) => ({ label: p.label, path: p.path })),
  tiles: [
    { id: 'production-mtd', title: 'Production MTD', path: '/tiles/production-mtd', roles: ROLES, refreshSeconds: 300 },
  ],
};

const STATIC = {
  '/static/numbers.css': ['numbers.css', 'text/css; charset=utf-8'],
  '/static/numbers.js': ['numbers.js', 'text/javascript; charset=utf-8'],
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

/**
 * @param {object} o
 * @param {string} o.secret     MODULE_SECRET
 * @param {string} o.stage      TDC_STAGE (design|live)
 * @param {object} o.client     gateway client from core/ (createClient with gatewayUrl/gatewayKey)
 * @param {boolean} [o.lists]   patient lists on the A/R page (PATIENT_LISTS, default on)
 * @param {string[]} [o.countCodes]  procedure codes for "Procedures I watch" (COUNT_CODES)
 * @param {string} [o.tz]       office time zone
 */
function createApp({ secret, stage, client, lists = true, countCodes = [], tz = 'America/Los_Angeles', now = () => Date.now(), log = (l) => console.log(l), tileTimeoutMs = 2500 }) {
  if (!secret || secret.length < 64) throw new Error('MODULE_SECRET must be at least 64 hex characters (32 random bytes).');
  if (stage !== 'design' && stage !== 'live') throw new Error('TDC_STAGE must be "design" or "live".');
  const data = createData({ client, now, tz, countCodes });

  // ---- Stage guard: the gateway must say the same stage we run in. ----
  const guard = { ok: false, message: 'Practice Numbers hasn\'t checked the gateway yet.', at: 0, running: null };
  function checkGateway() {
    if (guard.running) return guard.running;
    guard.running = checkStage(client, stage)
      .then(() => { guard.ok = true; guard.message = ''; })
      .catch((e) => {
        guard.ok = false;
        guard.message = e && e.code === 'config' && /stage/.test(e.message)
          ? ` ${e.message}`
          : ' The Open Dental gateway didn\'t answer, so nothing can be checked. It may be off, or its address (GATEWAY_URL) may be wrong. This page tries again by itself.';
        data.clear();
        log(JSON.stringify({ time: new Date(now()).toISOString(), event: 'stage-check', ok: false }));
      })
      .finally(() => { guard.at = now(); guard.running = null; });
    return guard.running;
  }
  async function stageOk() {
    if (!guard.ok && now() - guard.at > 15000) await checkGateway();
    return guard.ok;
  }

  async function productionTile() {
    const range = P.resolveRange({ range: 'mtd' }, data.today());
    const [cur, prev] = await Promise.all([
      data.report('production_by_provider', { from: range.cur.from, to: range.cur.to }),
      data.report('production_by_provider', { from: range.prev.from, to: range.prev.to }),
    ]);
    const updated = new Date(now()).toISOString();
    if (!cur.ok) return { title: 'Production MTD', value: pages.SHORT_WHY[cur.why] || 'Not responding', status: 'warn', items: [], link: '/', updated };
    const sum = (r) => r.rows.reduce((s, x) => s + (Number(x.GrossProduction) || 0), 0);
    const c = sum(cur); const p = prev.ok ? sum(prev) : null;
    const d = delta(c, p, true);
    const arrow = d.dir === 'up' ? '▲ up' : d.dir === 'down' ? '▼ down' : d.dir === 'flat' ? 'no change' : '';
    const items = [];
    if (p !== null) items.push({ text: `Last month to date (${range.prev.short}): ${money(p)}`, href: '/' });
    if (d.dir === 'up' || d.dir === 'down') items.push({ text: `${arrow} ${d.pct === null ? '' : pct(Math.abs(d.pct))} (${d.diff > 0 ? '+' : '−'}${money(Math.abs(d.diff))})`, href: '/' });
    items.push({ text: `${range.cur.short} so far`, href: '/production' });
    return { title: 'Production MTD', value: money(c), status: p === null || c >= p ? 'ok' : 'warn', items, link: '/', updated };
  }

  async function handle(req, res, who) {
    const url = new URL(req.url, 'http://module');
    const p = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });

    // CONTRACT §4: the manifest (requested as user "dashboard", role "system").
    if (p === '/manifest.json') return json(res, 200, MANIFEST);

    if (STATIC[p]) {
      const [file, type] = STATIC[p];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(__dirname, '..', 'public', file)));
    }

    // Everything below is owner and admin only (checked here, not just by the Dashboard).
    if (!hasRole(who, ROLES)) {
      if (p.startsWith('/tiles/') || p.startsWith('/api/')) return json(res, 403, { error: 'Not allowed' });
      return send(res, 403, pages.notAllowedPage({ who }));
    }

    if (p === '/tiles/production-mtd') {
      if (!(await stageOk())) return json(res, 200, { title: 'Production MTD', value: 'Paused', status: 'alert', items: [], link: '/', updated: new Date(now()).toISOString() });
      const timeout = new Promise((r) => setTimeout(() => r(null), tileTimeoutMs).unref());
      const tile = await Promise.race([productionTile(), timeout]);
      return json(res, 200, tile || { title: 'Production MTD', value: 'Loading…', status: 'warn', items: [], link: '/', updated: new Date(now()).toISOString() });
    }
    if (p.startsWith('/tiles/')) return json(res, 404, { error: 'No such tile' });

    if (!(await stageOk())) {
      if (p.startsWith('/api/')) return json(res, 503, { error: 'paused' });
      return send(res, 503, pages.pausedPage({ who, message: guard.message }));
    }

    const query = Object.fromEntries(url.searchParams);
    const today = data.today();
    const range = P.resolveRange(query, today);

    if (p === '/') {
      const lmFrom = P.addMonths(P.monthStart(today), -1);
      const [cmp, sched, trend, lm] = await Promise.all([
        data.compare(range), data.scheduledRestOfMonth(), data.trend(),
        data.report('production_by_provider', { from: lmFrom, to: P.monthEnd(lmFrom) }),
      ]);
      const lastMonthGross = lm.ok ? lm.rows.reduce((s, r) => s + (Number(r.GrossProduction) || 0), 0) : null;
      return send(res, 200, pages.glancePage({ who, range, cmp, sched, trend, lastMonthGross, today }));
    }
    if (p === '/production') {
      const [cmp, days, codes, counts] = await Promise.all([
        data.compare(range), data.byDay(range.cur.from, range.cur.to), data.byCode(range.cur.from, range.cur.to), data.counts(range),
      ]);
      const [provs, prevProvs] = await Promise.all([data.byProvider(cmp.cur), data.byProvider(cmp.prev)]);
      return send(res, 200, pages.productionPage({ who, range, cmp, provs, prevProvs, days, codes, counts }));
    }
    if (p === '/collections') {
      const cmp = await data.compare(range);
      const provs = await data.byProvider(cmp.cur);
      return send(res, 200, pages.collectionsPage({ who, range, cmp, provs }));
    }
    if (p === '/ar') {
      const [ar, cmp] = await Promise.all([data.arSummary(), data.compare(range)]);
      return send(res, 200, pages.arPage({ who, range, ar, cmp, lists }));
    }

    // Patient lists: only after a tap on the A/R page. Never cached, never logged.
    if (p.startsWith('/api/list/')) {
      if (!lists) return json(res, 404, { error: 'Patient lists are turned off (PATIENT_LISTS=off).' });
      const which = p.slice('/api/list/'.length);
      const fn = { families: data.arFamilies, outstanding: data.claimsOutstanding, unsent: data.claimsUnsent }[which];
      if (!fn) return json(res, 404, { error: 'No such list' });
      const out = await fn();
      if (!out.ok) return json(res, 502, { error: pages.SHORT_WHY[out.why] || 'Not responding' });
      return json(res, 200, { rows: out.rows, truncated: !!out.truncated });
    }

    return send(res, 404, pages.notFoundPage({ who }));
  }

  const server = http.createServer((req, res) => {
    const start = now();
    let user = '-';
    res.on('finish', () => {
      // CONTRACT §8: one JSON line per request. Path only: no query, no bodies, no patients.
      log(JSON.stringify({ time: new Date(start).toISOString(), user, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: now() - start }));
    });
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, version: VERSION, contract: 1 });

    // CONTRACT §3: everything else must be signed by the Dashboard.
    const who = verifyTdcRequest(secret, req, now());
    if (!who) { req.resume(); return send(res, 401, 'Unauthorized', 'text/plain; charset=utf-8'); }
    user = who.user;
    handle(req, res, who).catch((err) => {
      log(JSON.stringify({ time: new Date(now()).toISOString(), event: 'error', path: req.url.split('?')[0], code: (err && err.code) || 'error' }));
      if (!res.headersSent) send(res, 500, 'Something went wrong. Try again in a minute.', 'text/plain; charset=utf-8'); else res.destroy();
    });
    return undefined;
  });

  let timer = null;
  server.on('listening', () => {
    checkGateway();
    timer = setInterval(checkGateway, STAGE_CHECK_MS); timer.unref();
  });
  server.on('close', () => clearInterval(timer));
  return { server, checkGateway, guard, data };
}

module.exports = { createApp, MANIFEST, VERSION };
