'use strict';
// Everything this module asks Open Dental, always through the gateway with
// this module's own key (CONTRACT §7), using the shared core/ code.
//
// - Totals are cached in memory only, for a few minutes (CONTRACT §1).
//   Nothing from Open Dental is ever written to disk.
// - Patient lists (A/R by family, claims) are never cached at all.
// - A report that fails doesn't break the page: its section says
//   "Not available yet" (the gateway doesn't have it) or "Not responding".

const { runReport } = require('../vendor/opendental-core/reports');
const P = require('./periods');

const CACHE_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 400;
const CONCURRENCY = 6;

/** Why a report failed, in one word the pages understand. */
function reason(err) {
  const status = err && err.status;
  const code = err && err.code;
  if (status === 501 || code === 'not_implemented') return 'not_ready';
  if (status === 429 || code === 'rate_limited') return 'busy';
  if (status === 403) return 'not_allowed';
  if (status === 401) return 'bad_key';
  if (code === 'config') return 'config';
  return 'down';
}

function createData({ client, now = () => Date.now(), tz = 'America/Los_Angeles', countCodes = [] } = {}) {
  const cache = new Map();
  let active = 0; const queue = [];

  function limit(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; if (queue.length) queue.shift()(); });
      };
      if (active < CONCURRENCY) run(); else queue.push(run);
    });
  }

  function cached(key, fn) {
    const hit = cache.get(key);
    const t = now();
    if (hit && t - hit.t < CACHE_MS) return hit.p;
    const p = fn().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, { t, p });
    if (cache.size > MAX_ENTRIES) {
      for (const [k, v] of cache) { if (t - v.t >= CACHE_MS || cache.size > MAX_ENTRIES) cache.delete(k); else break; }
    }
    return p;
  }

  /** Run a totals report: { ok: true, rows } or { ok: false, why }. Never throws. */
  async function report(name, params = {}, opts = {}) {
    const run = () => limit(() => runReport(client, name, params, opts));
    try {
      const res = opts.noCache ? await run() : await cached(`${name}|${JSON.stringify(params)}|${opts.limit || ''}`, run);
      return { ok: true, rows: res.rows || [], truncated: !!res.truncated };
    } catch (err) {
      return { ok: false, why: reason(err) };
    }
  }

  const today = () => P.todayIn(tz, new Date(now()));

  /** Provider names by ProvNum (not patient data). */
  async function providers() {
    try {
      const rows = await cached('providers', () => limit(() => client.request('GET', '/providers')));
      const map = new Map();
      for (const p of Array.isArray(rows) ? rows : []) {
        const name = [p.FName, p.LName].filter(Boolean).join(' ').trim();
        map.set(Number(p.ProvNum), { abbr: p.Abbr || `#${p.ProvNum}`, name: name || p.Abbr || `Provider ${p.ProvNum}`, hidden: !!Number(p.IsHidden) });
      }
      return map;
    } catch { return new Map(); }
  }

  const sum = (res, col) => (res && res.ok ? res.rows.reduce((s, r) => s + (Number(r[col]) || 0), 0) : null);
  const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

  /**
   * The money totals for one period. Each value is a number, or null when its
   * report isn't available (the page shows "Not available yet").
   */
  async function totals(from, to) {
    const p = { from, to };
    const [prod, adj, wo, pat, ins, np] = await Promise.all([
      report('production_by_provider', p),
      report('adjustments_by_provider', p),
      report('writeoffs_by_provider', p),
      report('patient_payments_by_provider', p),
      report('insurance_payments_by_provider', p),
      report('new_patients', p),
    ]);
    const gross = r2(sum(prod, 'GrossProduction'));
    const adjustments = r2(sum(adj, 'Adjustments'));
    const writeoffs = r2(sum(wo, 'WriteOffs'));
    const patient = r2(sum(pat, 'PatientPayments'));
    const insurance = r2(sum(ins, 'InsurancePayments'));
    const net = gross !== null && adjustments !== null && writeoffs !== null ? r2(gross + adjustments - writeoffs) : null;
    const deductions = adjustments !== null && writeoffs !== null ? r2(writeoffs - adjustments) : null;
    const collections = patient !== null && insurance !== null ? r2(patient + insurance) : null;
    const rate = collections !== null && net ? collections / net : null;
    const newPatients = np.ok ? Number((np.rows[0] || {}).NewPatients) || 0 : null;
    const procCount = prod.ok ? prod.rows.reduce((s, r) => s + (Number(r.ProcCount) || 0), 0) : null;
    const why = {};
    for (const [k, res] of Object.entries({ production_by_provider: prod, adjustments_by_provider: adj, writeoffs_by_provider: wo, patient_payments_by_provider: pat, insurance_payments_by_provider: ins, new_patients: np })) {
      if (!res.ok) why[k] = res.why;
    }
    return { gross, adjustments, writeoffs, deductions, net, patient, insurance, collections, rate, newPatients, procCount, why, raw: { prod, adj, wo, pat, ins } };
  }

  /** Totals for the range, the previous period and last year, together. */
  async function compare(range) {
    const [cur, prev, ly] = await Promise.all([
      totals(range.cur.from, range.cur.to),
      totals(range.prev.from, range.prev.to),
      range.lastYear ? totals(range.lastYear.from, range.lastYear.to) : Promise.resolve(null),
    ]);
    return { cur, prev, ly };
  }

  /** Scheduled production from tomorrow to the end of this month. */
  async function scheduledRestOfMonth() {
    const t = today();
    const end = P.monthEnd(t);
    if (t >= end) return { ok: true, amount: 0, appointments: 0, from: null, to: end };
    const from = P.addDays(t, 1);
    const res = await report('scheduled_production', { from, to: end });
    if (!res.ok) return { ok: false, why: res.why, from, to: end };
    return { ok: true, amount: r2(sum(res, 'ScheduledProduction')), appointments: sum(res, 'Appointments'), from, to: end };
  }

  /**
   * 13 months of gross production, oldest first, from one report call.
   * (Collections by month would take 26 calls; see the README's "Next".)
   */
  async function trend() {
    const months = P.trendMonths(today());
    const first = months[0].from; const last = months[months.length - 1].to;
    const byDay = await report('production_by_day', { from: first, to: last }, { limit: 1000 });
    return months.map((m) => {
      const production = byDay.ok ? r2(byDay.rows.filter((r) => String(r.ProcDate).slice(0, 10) >= m.from && String(r.ProcDate).slice(0, 10) <= m.to).reduce((s, r) => s + (Number(r.GrossProduction) || 0), 0)) : null;
      return { ...m, production, why: byDay.ok ? null : byDay.why };
    });
  }

  /** Production per provider (gross, adjustments, write-offs, net) for a period. */
  async function byProvider(t) {
    const provs = await providers();
    const rows = new Map();
    const get = (n) => { if (!rows.has(n)) rows.set(n, { provNum: n, gross: 0, adjustments: 0, writeoffs: 0, procs: 0, patient: 0, insurance: 0 }); return rows.get(n); };
    const add = (res, col, key) => { if (res.ok) for (const r of res.rows) get(Number(r.ProvNum))[key] += Number(r[col]) || 0; };
    add(t.raw.prod, 'GrossProduction', 'gross'); add(t.raw.prod, 'ProcCount', 'procs');
    add(t.raw.adj, 'Adjustments', 'adjustments'); add(t.raw.wo, 'WriteOffs', 'writeoffs');
    add(t.raw.pat, 'PatientPayments', 'patient'); add(t.raw.ins, 'InsurancePayments', 'insurance');
    return [...rows.values()].map((r) => {
      const p = provs.get(r.provNum) || { abbr: r.provNum ? `#${r.provNum}` : 'None', name: r.provNum ? `Provider ${r.provNum}` : 'No provider' };
      return { ...r, abbr: p.abbr, name: p.name, net: r2(r.gross + r.adjustments - r.writeoffs), collections: r2(r.patient + r.insurance) };
    }).sort((a, b) => b.gross - a.gross || b.collections - a.collections);
  }

  /** Gross production per bucket (day, week or month) for a period. */
  async function byDay(from, to) {
    const res = await report('production_by_day', { from, to }, { limit: 1000 });
    if (!res.ok) return { ok: false, why: res.why };
    const bk = P.buckets(from, to);
    for (const b of bk) { b.amount = 0; b.procs = 0; }
    for (const r of res.rows) {
      const d = String(r.ProcDate).slice(0, 10);
      const b = bk.find((x) => d >= x.from && d <= x.to);
      if (b) { b.amount += Number(r.GrossProduction) || 0; b.procs += Number(r.ProcCount) || 0; }
    }
    for (const b of bk) b.amount = r2(b.amount);
    return { ok: true, buckets: bk };
  }

  async function byCode(from, to) {
    const res = await report('production_by_code', { from, to, limit: 25 });
    if (!res.ok) return { ok: false, why: res.why };
    return { ok: true, rows: res.rows.map((r) => ({ code: r.ProcCode, descript: r.Descript, qty: Number(r.Qty) || 0, amount: Number(r.Production) || 0 })) };
  }

  /** How many of the counted codes (setting COUNT_CODES) were completed, this period and the previous. */
  async function counts(range) {
    if (!countCodes.length) return { ok: true, rows: [] };
    const codes = countCodes.join(',');
    const [cur, prev] = await Promise.all([
      report('procedure_counts', { from: range.cur.from, to: range.cur.to, codes }),
      report('procedure_counts', { from: range.prev.from, to: range.prev.to, codes }),
    ]);
    if (!cur.ok) return { ok: false, why: cur.why };
    const tally = (res) => { const m = new Map(); if (res.ok) for (const r of res.rows) m.set(r.ProcCode, (m.get(r.ProcCode) || 0) + (Number(r.Qty) || 0)); return m; };
    const c = tally(cur); const p = tally(prev);
    const names = new Map(cur.rows.map((r) => [r.ProcCode, r.Descript]));
    return { ok: true, prevOk: prev.ok, rows: countCodes.map((code) => ({ code, descript: names.get(code) || '', qty: c.get(code) || 0, prev: prev.ok ? p.get(code) || 0 : null })) };
  }

  /** Office-wide A/R snapshot plus claim totals (no patient names). */
  async function arSummary() {
    const [tot, out, unsent] = await Promise.all([
      report('ar_aging_totals', {}),
      report('outstanding_claims', { limit: 5000 }, { noCache: true }),
      report('unsent_claims', {}, { noCache: true }),
    ]);
    const res = { totals: null, claims: null, unsent: null, why: {} };
    if (tot.ok) {
      const r = tot.rows[0] || {};
      const n = (k) => Number(r[k]) || 0;
      res.totals = { b0: n('Bal_0_30'), b1: n('Bal_31_60'), b2: n('Bal_61_90'), b3: n('BalOver90'), insEst: n('InsEst'), total: n('BalTotal'), credits: n('CreditBalances') };
    } else res.why.ar_aging_totals = tot.why;
    // Claims: only counts and sums leave this function; the rows are dropped.
    if (out.ok) {
      const b = [0, 0, 0, 0].map(() => ({ count: 0, fee: 0, est: 0 }));
      for (const c of out.rows) {
        const d = Number(c.DaysOut) || 0;
        const i = d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3;
        b[i].count++; b[i].fee += Number(c.ClaimFee) || 0; b[i].est += Number(c.InsPayEst) || 0;
      }
      res.claims = { buckets: b.map((x) => ({ count: x.count, fee: r2(x.fee), est: r2(x.est) })), count: out.rows.length, fee: r2(b.reduce((s, x) => s + x.fee, 0)), est: r2(b.reduce((s, x) => s + x.est, 0)), truncated: out.truncated };
    } else res.why.outstanding_claims = out.why;
    if (unsent.ok) {
      const st = { U: 0, W: 0, H: 0 };
      for (const c of unsent.rows) if (st[c.ClaimStatus] !== undefined) st[c.ClaimStatus]++;
      res.unsent = { count: unsent.rows.length, fee: r2(sum(unsent, 'ClaimFee')), byStatus: st };
    } else res.why.unsent_claims = unsent.why;
    return res;
  }

  // ---- Patient lists: only after a tap, never cached, never logged. ----

  async function arFamilies() {
    const res = await report('ar_aging', { limit: 500 }, { noCache: true });
    if (!res.ok) return res;
    return { ok: true, truncated: res.truncated, rows: res.rows.map((r) => ({ patNum: r.PatNum, name: `${r.LName || ''}, ${r.FName || ''}`.replace(/^, |, $/g, ''), b0: +r.Bal_0_30 || 0, b1: +r.Bal_31_60 || 0, b2: +r.Bal_61_90 || 0, b3: +r.BalOver90 || 0, insEst: +r.InsEst || 0, total: +r.BalTotal || 0, patPortion: +r.PatPortion || 0 })) };
  }
  async function claimsOutstanding() {
    const res = await report('outstanding_claims', { limit: 1000 }, { noCache: true });
    if (!res.ok) return res;
    return { ok: true, truncated: res.truncated, rows: res.rows.map((c) => ({ claimNum: c.ClaimNum, name: `${c.LName || ''}, ${c.FName || ''}`.replace(/^, |, $/g, ''), carrier: c.CarrierName || '', service: String(c.DateService || '').slice(0, 10), sent: String(c.DateSent || '').slice(0, 10), daysOut: Number(c.DaysOut) || 0, fee: +c.ClaimFee || 0, est: +c.InsPayEst || 0, type: c.ClaimType === 'S' ? 'Secondary' : 'Primary' })) };
  }
  async function claimsUnsent() {
    const res = await report('unsent_claims', {}, { noCache: true });
    if (!res.ok) return res;
    const st = { U: 'Unsent', W: 'Waiting to send', H: 'On hold' };
    return { ok: true, rows: res.rows.map((c) => ({ claimNum: c.ClaimNum, name: `${c.LName || ''}, ${c.FName || ''}`.replace(/^, |, $/g, ''), carrier: c.CarrierName || '', service: String(c.DateService || '').slice(0, 10), status: st[c.ClaimStatus] || c.ClaimStatus, fee: +c.ClaimFee || 0, type: c.ClaimType === 'S' ? 'Secondary' : 'Primary' })) };
  }

  return { today, report, providers, totals, compare, scheduledRestOfMonth, trend, byProvider, byDay, byCode, counts, arSummary, arFamilies, claimsOutstanding, claimsUnsent, clear: () => cache.clear() };
}

module.exports = { createData, reason };
