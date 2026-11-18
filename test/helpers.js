'use strict';
// Test helpers: Practice Numbers with a made-up gateway (no network, no
// Open Dental). Every name and number here is invented.
const crypto = require('node:crypto');
const http = require('node:http');
const { createApp } = require('../lib/app');
const { tdcSignature } = require('../lib/tdc-verify');

const SECRET = 'a1'.repeat(32);
const NAMES = [['Testerson', 'Zorbelle'], ['Samplefield', 'Quixley']];

/** A fake gateway client with the same interface as core/'s gateway client. */
function fakeClient({ stage = 'design', missing = [], down = false } = {}) {
  const calls = [];
  const err = (status, code) => Object.assign(new Error(code), { status, code });
  return {
    calls,
    async health() { if (down) throw err(0, 'unreachable'); return { ok: true, stage, fake: true }; },
    async request(method, p) { calls.push(['GET', p]); return [{ ProvNum: 1, Abbr: 'DOC1', FName: 'Avery', LName: 'Doctorly' }, { ProvNum: 2, Abbr: 'HYG1', FName: 'Blake', LName: 'Hygienly' }]; },
    async runReport(name, p) {
      calls.push([name, p]);
      if (down) throw err(0, 'unreachable');
      if (missing.includes(name)) throw err(501, 'not_implemented');
      const days = p.from && p.to ? Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1 : 1;
      switch (name) {
        case 'production_by_provider': return { rows: [{ ProvNum: 1, GrossProduction: 1000 * days, ProcCount: 4 * days }, { ProvNum: 2, GrossProduction: 300 * days, ProcCount: 3 * days }] };
        case 'adjustments_by_provider': return { rows: [{ ProvNum: 1, Adjustments: -20 * days, AdjCount: days }] };
        case 'writeoffs_by_provider': return { rows: [{ ProvNum: 1, WriteOffs: 80 * days }, { ProvNum: 2, WriteOffs: 20 * days }] };
        case 'patient_payments_by_provider': return { rows: [{ ProvNum: 1, PatientPayments: 400 * days, SplitCount: days }] };
        case 'insurance_payments_by_provider': return { rows: [{ ProvNum: 1, InsurancePayments: 600 * days }, { ProvNum: 2, InsurancePayments: 150 * days }] };
        case 'new_patients': return { rows: [{ NewPatients: days }] };
        case 'production_by_day': return { rows: [{ ProcDate: p.from, GrossProduction: 1300, ProcCount: 7 }, { ProcDate: p.to, GrossProduction: 900, ProcCount: 5 }] };
        case 'production_by_code': return { rows: [{ ProcCode: 'D2740', Descript: 'Crown - porcelain/ceramic', Qty: 2, Production: 2500 }] };
        case 'procedure_counts': return { rows: [{ ProcDate: p.from, ProcCode: 'D2740', Descript: 'Crown', Qty: 2 }] };
        case 'scheduled_production': return { rows: [{ AptDate: p.from, ProvNum: 1, Appointments: 5, ScheduledProduction: 2400 }] };
        case 'ar_aging_totals': return { rows: [{ Bal_0_30: 5000, Bal_31_60: 1200, Bal_61_90: 600, BalOver90: 900, InsEst: 2000, BalTotal: 7600, CreditBalances: -100 }] };
        case 'ar_aging': return { rows: NAMES.map(([l, f], i) => ({ PatNum: 900 + i, LName: l, FName: f, Bal_0_30: 100, Bal_31_60: 0, Bal_61_90: 0, BalOver90: 50, InsEst: 20, BalTotal: 150, PatPortion: 130 })) };
        case 'outstanding_claims': return { rows: NAMES.map(([l, f], i) => ({ ClaimNum: 70 + i, PatNum: 900 + i, LName: l, FName: f, CarrierName: 'Example Benefit Co', DateService: '2026-10-01', DateSent: '2026-10-02', DaysOut: 20 + i * 80, ClaimFee: 500, InsPayEst: 300, ClaimType: 'P' })) };
        case 'unsent_claims': return { rows: [{ ClaimNum: 80, PatNum: 900, LName: NAMES[0][0], FName: NAMES[0][1], CarrierName: 'Example Benefit Co', DateService: '2026-11-10', ClaimStatus: 'U', ClaimFee: 250, ClaimType: 'P' }] };
        default: throw err(404, 'not_found');
      }
    },
  };
}

async function start(opts = {}) {
  const logs = [];
  const client = opts.client || fakeClient(opts);
  const app = createApp({ secret: SECRET, stage: opts.appStage || 'design', client, lists: opts.lists !== false, countCodes: ['D2740'], log: (l) => logs.push(l), tileTimeoutMs: opts.tileTimeoutMs });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  function req(p, { roles = 'owner', sign = true, method = 'GET', time = Date.now() } = {}) {
    const headers = {};
    if (sign) {
      const t = String(time);
      Object.assign(headers, { 'x-tdc-user': 'tester', 'x-tdc-name': 'Test Owner', 'x-tdc-roles': roles, 'x-tdc-base': '/m/numbers', 'x-tdc-time': t, 'x-tdc-sig': tdcSignature(SECRET, t, method, p, 'tester', roles, '/m/numbers') });
    }
    return new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
      });
      r.on('error', reject); r.end();
    });
  }
  return { app, client, logs, req, close: () => new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }) };
}

module.exports = { start, fakeClient, SECRET, NAMES, crypto };
