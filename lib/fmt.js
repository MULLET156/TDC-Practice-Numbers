'use strict';
// Number and text formatting for the pages.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** $12,345 (whole dollars; -$1,234 for negatives). */
function money(n) { return n === null || n === undefined || Number.isNaN(n) ? '—' : usd0.format(Math.round(n) || 0); }
/** $12,345.67 */
function money2(n) { return n === null || n === undefined || Number.isNaN(n) ? '—' : usd2.format(n); }
/** $850, $12.3k, $1.24M — for chart labels. */
function moneyShort(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const a = Math.abs(n); const s = n < 0 ? '-' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${Math.round(a)}`;
}
function count(n) { return n === null || n === undefined ? '—' : int.format(n); }
function pct(x, digits = 1) { return x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(digits)}%`; }

/**
 * Change from prev to cur. goodWhenUp says whether going up is good news
 * (production: yes; write-offs: no). Returns { dir, pct, diff, tone }.
 * tone: 'good' | 'bad' | 'flat' | 'none'.
 */
function delta(cur, prev, goodWhenUp = true) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return { dir: 'none', tone: 'none', pct: null, diff: null };
  const diff = cur - prev;
  const p = prev !== 0 ? diff / Math.abs(prev) : null;
  if (Math.abs(diff) < 0.005 || (p !== null && Math.abs(p) < 0.0005)) return { dir: 'flat', tone: 'flat', pct: 0, diff: 0 };
  const dir = diff > 0 ? 'up' : 'down';
  return { dir, pct: p, diff, tone: (dir === 'up') === goodWhenUp ? 'good' : 'bad' };
}

/**
 * The arrow line: "▲ 8.8%  vs Oct 1 – 17 · $38,900". Always has words for
 * screen readers and a colour that matches the tone (DESIGN: never colour alone).
 */
function deltaHtml(d, vsLabel, prevText) {
  const arrow = { up: '▲', down: '▼', flat: '▬', none: '' }[d.dir];
  const words = { up: 'Up', down: 'Down', flat: 'No change', none: '' }[d.dir];
  let amount = '';
  if (d.dir === 'up' || d.dir === 'down') amount = d.pct === null ? 'new' : pct(Math.abs(d.pct));
  const head = d.dir === 'none'
    ? '<span class="pn-delta" data-tone="none">—</span>'
    : `<span class="pn-delta" data-tone="${d.tone}"><span aria-hidden="true">${arrow}</span><span class="tdc-visually-hidden">${words}</span> ${esc(amount || '0%')}</span>`;
  return `${head} <span class="pn-vs">vs ${esc(vsLabel)}${prevText ? ` · <span class="pn-num">${esc(prevText)}</span>` : ''}</span>`;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon, Nov 16" (DESIGN.md §7) from 'YYYY-MM-DD'. */
function dayShort(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

module.exports = { esc, money, money2, moneyShort, count, pct, delta, deltaHtml, dayShort, MONTHS_LONG };
