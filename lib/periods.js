'use strict';
// Date ranges for the range picker: this month, last month, quarter, year to
// date, custom. Each range comes with the period it is compared with
// ("previous period") and the same dates last year. Dates are plain
// 'YYYY-MM-DD' strings; all arithmetic is done in UTC so time zones and
// daylight saving never shift a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(s) {
  const m = RE.exec(String(s || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function toUTC(s) { const p = parse(s); return Date.UTC(p.y, p.m - 1, p.d); }
function fromUTC(t) { const d = new Date(t); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
function addDays(s, n) { return fromUTC(toUTC(s) + n * 86400000); }
function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
function isValid(s) { return parse(s) !== null; }

/** Same month/day in another year; Feb 29 becomes Feb 28. */
function shiftYears(s, n) {
  const p = parse(s);
  return ymd(p.y + n, p.m, Math.min(p.d, daysInMonth(p.y + n, p.m)));
}
/** Month start/end helpers. */
function monthStart(s) { const p = parse(s); return ymd(p.y, p.m, 1); }
function monthEnd(s) { const p = parse(s); return ymd(p.y, p.m, daysInMonth(p.y, p.m)); }
function addMonths(s, n) {
  const p = parse(s);
  const idx = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(idx / 12); const m = (idx % 12) + 1;
  return ymd(y, m, Math.min(p.d, daysInMonth(y, m)));
}
function quarterStart(s) { const p = parse(s); return ymd(p.y, Math.floor((p.m - 1) / 3) * 3 + 1, 1); }

/** Today's date in a time zone (default the office's), as 'YYYY-MM-DD'. */
function todayIn(tz = 'America/Los_Angeles', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Nov 1 – 17, 2026", "Oct 1 – Nov 17, 2026", "Dec 1, 2025 – Jan 5, 2026", "Nov 17, 2026". */
function label(from, to) {
  const a = parse(from); const b = parse(to);
  if (from === to) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y}`;
  if (a.y !== b.y) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
  return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${a.y}`;
}
/** Short label without the year where it's obvious: "Oct 1 – 17". */
function shortLabel(from, to) {
  const a = parse(from); const b = parse(to);
  if (from === to) return `${MONTHS[a.m - 1]} ${a.d}`;
  if (a.y !== b.y) return label(from, to);
  if (a.m !== b.m) return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}`;
  return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}`;
}
function monthLabel(s) { const p = parse(s); return `${MONTHS[p.m - 1]} ${p.y}`; }
function monthShort(s) { const p = parse(s); return MONTHS[p.m - 1]; }

const RANGES = [
  { key: 'mtd', label: 'This month' },
  { key: 'lm', label: 'Last month' },
  { key: 'qtd', label: 'Quarter' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
];
const MAX_CUSTOM_DAYS = 731;

const span = (from, to) => ({ from, to, label: label(from, to), short: shortLabel(from, to) });

/**
 * Turn the picker's query (?range=mtd|lm|qtd|ytd|custom&from=&to=) into
 * { key, name, cur, prev, prevName, lastYear } where each period is
 * { from, to, label, short }. lastYear is null when it equals prev (year to date).
 * Bad or missing input falls back to this month.
 */
function resolveRange(query, today) {
  const q = query || {};
  let key = RANGES.some((r) => r.key === q.range) ? q.range : 'mtd';
  const t = parse(today);
  let cur; let prev; let prevName;
  if (key === 'custom') {
    let from = String(q.from || ''); let to = String(q.to || '');
    if (!isValid(from) || !isValid(to)) key = 'mtd';
    else {
      if (from > to) [from, to] = [to, from];
      if (daysBetween(from, to) > MAX_CUSTOM_DAYS) from = addDays(to, -MAX_CUSTOM_DAYS);
      const len = daysBetween(from, to) + 1;
      cur = span(from, to);
      prev = span(addDays(from, -len), addDays(from, -1));
      prevName = 'the period before';
    }
  }
  if (key === 'mtd') {
    const from = ymd(t.y, t.m, 1);
    cur = span(from, today);
    const pm = addMonths(from, -1);
    prev = span(pm, ymd(parse(pm).y, parse(pm).m, Math.min(t.d, daysInMonth(parse(pm).y, parse(pm).m))));
    prevName = 'same days last month';
  } else if (key === 'lm') {
    const from = addMonths(ymd(t.y, t.m, 1), -1);
    cur = span(from, monthEnd(from));
    const pm = addMonths(from, -1);
    prev = span(pm, monthEnd(pm));
    prevName = 'the month before';
  } else if (key === 'qtd') {
    const from = quarterStart(today);
    cur = span(from, today);
    const pq = addMonths(from, -3);
    const pqEnd = addDays(from, -1);
    let pto = addDays(pq, daysBetween(from, today));
    if (pto > pqEnd) pto = pqEnd;
    prev = span(pq, pto);
    prevName = 'same days last quarter';
  } else if (key === 'ytd') {
    const from = ymd(t.y, 1, 1);
    cur = span(from, today);
    prev = span(shiftYears(from, -1), shiftYears(today, -1));
    prevName = 'same days last year';
  }
  let lastYear = span(shiftYears(cur.from, -1), shiftYears(cur.to, -1));
  if (key === 'lm') lastYear = span(shiftYears(cur.from, -1), monthEnd(shiftYears(cur.from, -1)));
  if (lastYear.from === prev.from && lastYear.to === prev.to) lastYear = null;
  const name = RANGES.find((r) => r.key === key).label;
  return { key, name, cur, prev, prevName, lastYear };
}

/** The query string that reproduces a range (for links between pages). */
function rangeQuery(range) {
  if (!range || range.key === 'mtd') return '';
  if (range.key === 'custom') return `?range=custom&from=${range.cur.from}&to=${range.cur.to}`;
  return `?range=${range.key}`;
}

/** The last 13 months, oldest first: [{ from, to, label, short }]; the last one ends today. */
function trendMonths(today, n = 13) {
  const out = [];
  const first = addMonths(monthStart(today), -(n - 1));
  for (let i = 0; i < n; i++) {
    const from = addMonths(first, i);
    const to = i === n - 1 ? today : monthEnd(from);
    out.push({ from, to, label: monthLabel(from), short: monthShort(from) });
  }
  return out;
}

/**
 * Bucket a daily range for a chart: by day up to 62 days, by week up to
 * 371 days (weeks start Monday), else by month. Returns [{ from, to, label }].
 */
function buckets(from, to) {
  const days = daysBetween(from, to) + 1;
  const out = [];
  if (days <= 62) {
    for (let d = from; d <= to; d = addDays(d, 1)) { const p = parse(d); out.push({ from: d, to: d, label: `${MONTHS[p.m - 1]} ${p.d}`, unit: 'day' }); }
  } else if (days <= 371) {
    let d = from;
    while (d <= to) {
      const dow = new Date(toUTC(d)).getUTCDay(); // 0 Sunday
      let end = addDays(d, (7 - dow) % 7); // through Sunday
      if (end > to) end = to;
      const p = parse(d);
      out.push({ from: d, to: end, label: `${MONTHS[p.m - 1]} ${p.d}`, unit: 'week' });
      d = addDays(end, 1);
    }
  } else {
    let d = from;
    while (d <= to) {
      let end = monthEnd(d); if (end > to) end = to;
      out.push({ from: d, to: end, label: monthLabel(d), unit: 'month' });
      d = addDays(end, 1);
    }
  }
  return out;
}

module.exports = {
  parse, isValid, addDays, daysBetween, addMonths, shiftYears, monthStart, monthEnd, quarterStart,
  todayIn, label, shortLabel, monthLabel, resolveRange, rangeQuery, trendMonths, buckets, RANGES, MONTHS,
};
