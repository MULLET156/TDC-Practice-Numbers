'use strict';
// The pages of Practice Numbers. Built to DESIGN.md with the shared classes
// from the Dashboard's /shared/tdc.css; the few things the shared kit has no
// class for (number cards and charts) are in public/numbers.css and use only
// --tdc-* colours.
//
// Totals pages never show a patient. Patient lists (A/R by family, claims)
// load only after a tap, from /api/list/*, and are never cached.

const { esc, money, money2, moneyShort, count, pct, delta, deltaHtml, dayShort } = require('./fmt');
const { columnChart, barChart, figure } = require('./charts');
const P = require('./periods');

const PAGES = [
  { path: '/', label: 'At a glance', short: 'Glance', icon: 'chart', title: 'At a glance' },
  { path: '/production', label: 'Production', short: 'Production', icon: 'tooth', title: 'Production' },
  { path: '/collections', label: 'Collections', short: 'Collect', icon: 'dollar', title: 'Collections' },
  { path: '/ar', label: 'A/R', short: 'A/R', icon: 'clock', title: 'A/R and claims' },
];

const REPORT_NAMES = {
  production_by_provider: 'Production by provider', production_by_day: 'Production by day', production_by_code: 'Production by code',
  procedure_counts: 'Procedure counts', adjustments_by_provider: 'Adjustments', writeoffs_by_provider: 'Write-offs',
  patient_payments_by_provider: 'Patient payments', insurance_payments_by_provider: 'Insurance payments',
  scheduled_production: 'Scheduled production', new_patients: 'New patients', ar_aging_totals: 'A/R aging totals',
  ar_aging: 'A/R by family', outstanding_claims: 'Outstanding claims', unsent_claims: 'Unsent claims',
};
const WHY = {
  not_ready: 'the gateway doesn\'t answer this report yet',
  not_allowed: 'not allowed for this module\'s gateway key',
  bad_key: 'the gateway didn\'t accept this module\'s key',
  config: 'the gateway settings (GATEWAY_URL, GATEWAY_KEY) need checking',
  busy: 'the gateway is busy (too many requests this minute); reload in a minute',
  down: 'not responding',
};
const SHORT_WHY = { not_ready: 'Not available yet', not_allowed: 'Not allowed', bad_key: 'Gateway key refused', config: 'Check settings', busy: 'Busy, reload in a minute', down: 'Not responding' };

// ------------------------------------------------------------------ shell

function layout({ who, title, current, range, body, scripts = true }) {
  const b = esc(who.base);
  const q = esc(P.rangeQuery(range));
  const tabs = PAGES.map((p) => `<a class="tdc-stat" data-status="accent" href="${b}${p.path === '/' ? '/' : p.path}${q}"${p.path === current ? ' aria-current="page"' : ''}><span data-icon="${p.icon}"></span><span class="tdc-stat-label" data-short="${esc(p.short)}">${esc(p.label)}</span></a>`).join('\n');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · Practice Numbers · Toledo Dental Care</title>
<link rel="stylesheet" href="/shared/tdc.css">
<link rel="stylesheet" href="${b}/static/numbers.css">
<script src="/shared/shell.js" defer></script>
${scripts ? `<script src="${b}/static/numbers.js" defer></script>` : ''}
</head>
<body data-module="numbers" data-base="${b}">
<main class="tdc-main">
<nav class="tdc-stats" aria-label="Practice Numbers pages">
${tabs}
</nav>
${body}
</main>
</body></html>`;
}

function pagehead(icon, title, count, help) {
  return `<header class="tdc-pagehead"><h2><span data-icon="${icon}"></span>${esc(title)}</h2><span class="tdc-count">${esc(count)}</span>${help ? `<p class="tdc-help">${esc(help)}</p>` : ''}</header>`;
}

/** The date-range picker (every page). Works without scripts: it's a GET form. */
function picker(range, note = '') {
  const btn = (k, l) => `<button type="submit" name="range" value="${k}" aria-pressed="${range.key === k}">${esc(l)}</button>`;
  const cmp = [`<strong class="pn-num">${esc(range.prev.label)}</strong> (${esc(range.prevName)})`];
  if (range.lastYear) cmp.push(`<strong class="pn-num">${esc(range.lastYear.label)}</strong> (last year)`);
  return `<form class="pn-range" method="get" action="" data-range="${esc(range.key)}">
<div class="tdc-seg" role="group" aria-label="Date range">
${btn('mtd', 'This month')}${btn('lm', 'Last month')}${btn('qtd', 'Quarter')}${btn('ytd', 'Year to date')}<button type="button" class="pn-custom-btn" aria-pressed="${range.key === 'custom'}" aria-controls="pn-custom">Custom</button>
</div>
<div class="pn-custom" id="pn-custom">
<label>From <input type="date" name="from" value="${esc(range.cur.from)}" required></label>
<label>To <input type="date" name="to" value="${esc(range.cur.to)}" required></label>
<button type="submit" name="range" value="custom" class="tdc-btn tdc-btn-primary">Show</button>
</div>
<p class="pn-cmp">Compared with ${cmp.join(' and ')}.${note ? ` ${esc(note)}` : ''}</p>
</form>`;
}

/** One callout listing reports that didn't answer (nothing shown if all did). */
function missingCallout(whyMap) {
  const entries = Object.entries(whyMap || {});
  if (!entries.length) return '';
  const notReady = entries.every(([, w]) => w === 'not_ready');
  const items = entries.map(([name, why]) => `<li>${esc(REPORT_NAMES[name] || name)}: ${esc(WHY[why] || WHY.down)}</li>`).join('');
  return `<div class="tdc-callout" data-status="${notReady ? 'info' : 'warn'}" role="status"><span data-icon="${notReady ? 'pending' : 'alert'}"></span><div><strong>Some numbers aren't here yet</strong><ul class="pn-missing">${items}</ul>${notReady ? '<span class="pn-note">They fill in by themselves as the gateway adds them (opendental-claude issue #14).</span>' : ''}</div></div>`;
}

function mergeWhy(...objs) { return Object.assign({}, ...objs.filter(Boolean)); }

// ------------------------------------------------------------------ number cards

/**
 * A number card. spec: { label, value (number|null), fmt, why, goodWhenUp, prev, ly, sub, icon }
 * When value is null, the card says why instead of showing a number.
 */
function kpi(spec, range) {
  const f = spec.fmt || money;
  if (spec.value === null || spec.value === undefined) {
    return `<article class="pn-kpi" data-empty="true"><h3 class="pn-kpi-label">${esc(spec.label)}</h3><p class="pn-kpi-value pn-na">${esc(SHORT_WHY[spec.why] || 'Not available yet')}</p>${spec.sub ? `<p class="pn-kpi-sub">${spec.sub}</p>` : ''}</article>`;
  }
  const lines = [];
  if (spec.prev !== undefined && range) lines.push(`<p class="pn-kpi-line">${deltaHtml(delta(spec.value, spec.prev, spec.goodWhenUp !== false), range.prev.short, spec.prev === null ? '' : f(spec.prev))}</p>`);
  if (spec.ly !== undefined && range && range.lastYear) lines.push(`<p class="pn-kpi-line">${deltaHtml(delta(spec.value, spec.ly, spec.goodWhenUp !== false), 'last year', spec.ly === null ? '' : f(spec.ly))}</p>`);
  return `<article class="pn-kpi"${spec.big ? ' data-big="true"' : ''}><h3 class="pn-kpi-label">${spec.icon ? `<span data-icon="${spec.icon}"></span>` : ''}${esc(spec.label)}</h3><p class="pn-kpi-value">${esc(f(spec.value))}</p>${spec.meter !== undefined ? `<span class="tdc-meter" data-status="${spec.meterStatus || 'accent'}" style="--value: ${Math.max(0, Math.min(100, Math.round(spec.meter * 100)))}%"></span>` : ''}${lines.join('')}${spec.sub ? `<p class="pn-kpi-sub">${spec.sub}</p>` : ''}</article>`;
}

/** Pull one field from the three periods into a card spec. */
function trio(cmp, field, extra = {}) {
  return { value: cmp.cur[field], prev: cmp.prev[field], ly: cmp.ly ? cmp.ly[field] : undefined, ...extra };
}
/** Why a combined field is missing: the first failing report behind it. */
function whyFor(t, names) { for (const n of names) if (t.why[n]) return t.why[n]; return 'down'; }

function rateStatus(r) { return r === null ? 'new' : r >= 0.98 ? 'ok' : r >= 0.9 ? 'warn' : 'alert'; }

// ------------------------------------------------------------------ tables

function table(head, rows, { foot, numCols = [] } = {}) {
  const th = head.map((h, i) => `<th scope="col"${numCols.includes(i) ? ' class="pn-r"' : ''}>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td${numCols.includes(i) ? ' class="pn-r pn-num"' : ''}>${c}</td>`)).join('')}</tr>`).join('');
  const tf = foot ? `<tfoot><tr>${foot.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td${numCols.includes(i) ? ' class="pn-r pn-num"' : ''}>${c}</td>`)).join('')}</tr></tfoot>` : '';
  return `<table class="tdc-table pn-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${tf}</table>`;
}
const chg = (cur, prev, goodWhenUp = true) => {
  const d = delta(cur, prev, goodWhenUp);
  if (d.dir === 'none') return '—';
  if (d.dir === 'flat') return '<span class="pn-delta" data-tone="flat">▬ 0%</span>';
  return `<span class="pn-delta" data-tone="${d.tone}"><span aria-hidden="true">${d.dir === 'up' ? '▲' : '▼'}</span><span class="tdc-visually-hidden">${d.dir === 'up' ? 'Up' : 'Down'}</span> ${d.pct === null ? 'new' : pct(Math.abs(d.pct))}</span>`;
};

function emptyCard(title, text) { return `<div class="tdc-empty"><p>${esc(title)}</p>${esc(text)}</div>`; }
function naFigure(title, why) {
  return `<section class="pn-figure"><div class="pn-figcap"><span class="pn-figtitle">${esc(title)}</span></div>${emptyCard(SHORT_WHY[why] || 'Not available yet', why === 'not_ready' ? 'The gateway doesn\'t answer this report yet. It appears here by itself once it does.' : 'The gateway didn\'t answer. The rest of the page still works; try again in a minute.')}</section>`;
}

// ------------------------------------------------------------------ At a glance

function glancePage({ who, range, cmp, sched, trend, lastMonthGross, today }) {
  const c = cmp.cur;
  const deductSub = c.adjustments !== null && c.writeoffs !== null ? `Write-offs <span class="pn-num">${money(c.writeoffs)}</span> · adjustments <span class="pn-num">${money(c.adjustments)}</span>` : '';
  const cards = [
    kpi(trio(cmp, 'gross', { label: 'Gross production', icon: 'tooth', big: true, why: whyFor(c, ['production_by_provider']), sub: c.procCount !== null ? `<span class="pn-num">${count(c.procCount)}</span> procedures completed` : '' }), range),
    kpi(trio(cmp, 'collections', { label: 'Collections', icon: 'dollar', big: true, why: whyFor(c, ['patient_payments_by_provider', 'insurance_payments_by_provider']), sub: c.collections !== null ? `Patients <span class="pn-num">${money(c.patient)}</span> · insurance <span class="pn-num">${money(c.insurance)}</span>` : '' }), range),
    kpi(trio(cmp, 'net', { label: 'Net production', why: whyFor(c, ['production_by_provider', 'adjustments_by_provider', 'writeoffs_by_provider']), sub: 'Gross, less adjustments and write-offs' }), range),
    kpi(trio(cmp, 'deductions', { label: 'Adjustments and write-offs', goodWhenUp: false, why: whyFor(c, ['adjustments_by_provider', 'writeoffs_by_provider']), sub: deductSub }), range),
    kpi(trio(cmp, 'newPatients', { label: 'New patients', icon: 'plus', fmt: count, why: whyFor(c, ['new_patients']) }), range),
    kpi(trio(cmp, 'rate', { label: 'Collection rate', fmt: (x) => pct(x), why: whyFor(c, ['patient_payments_by_provider', 'insurance_payments_by_provider', 'adjustments_by_provider', 'writeoffs_by_provider']), meter: c.rate === null ? undefined : Math.min(c.rate, 1), meterStatus: rateStatus(c.rate), sub: 'Collections ÷ net production' }), range),
  ];

  // Rest of this month: scheduled production, and where the month is heading.
  let rest;
  const monthName = P.monthLabel(today);
  if (!sched.ok) {
    rest = kpi({ label: 'Scheduled, rest of the month', value: null, why: sched.why }, null);
  } else {
    const restLabel = sched.from ? P.shortLabel(sched.from, sched.to) : 'month ends today';
    rest = kpi({ label: 'Scheduled, rest of the month', icon: 'calendar', value: sched.amount, sub: `<span class="pn-num">${esc(restLabel)}</span> · <span class="pn-num">${count(sched.appointments)}</span> appointments` }, null);
  }
  const mtdGross = range.key === 'mtd' ? cmp.cur.gross : null;
  let projected = '';
  if (range.key === 'mtd' && sched.ok && mtdGross !== null) {
    const proj = mtdGross + sched.amount;
    projected = kpi({ label: `${monthName}: done plus scheduled`, icon: 'pulse', value: proj, prev: lastMonthGross, sub: 'Production so far plus what\'s on the books. Compared with all of last month.' }, { prev: { short: 'all last month' }, lastYear: null });
  }

  const s1 = [{ name: 'Gross production', cls: 'pn-s1' }];
  const tChart = trend.some((m) => m.production !== null) ? figure({
    id: 'trend',
    title: '13-month trend: gross production',
    wide: columnChart({ title: 'Gross production by month', items: trend.map((m, i) => ({ label: i === 0 || m.short === 'Jan' ? `${m.short} ${m.from.slice(2, 4)}` : m.short, values: [m.production], highlight: i === trend.length - 1 })), series: s1 }),
    narrow: barChart({ width: 360, labelWidth: 64, valueWidth: 70, title: 'Gross production by month', items: trend.slice().reverse().map((m) => ({ label: `${m.short} ${m.from.slice(2, 4)}`, values: [m.production] })), series: s1 }),
    table: table(['Month', 'Gross production', 'Change from the month before'], trend.map((m, i) => [esc(m.label) + (m.to < P.monthEnd(m.from) ? ' <span class="tdc-muted">(so far)</span>' : ''), money(m.production), i === 0 ? '—' : chg(m.production, trend[i - 1].production)]), { numCols: [1, 2] }),
    note: 'The last bar (outlined) is this month so far.',
  }) : naFigure('13-month trend', trend[0] ? trend[0].why : 'down');

  const why = mergeWhy(cmp.cur.why, sched.ok ? null : { scheduled_production: sched.why }, trend[0] && trend[0].why ? { production_by_day: trend[0].why } : null);
  const body = `${pagehead('chart', 'At a glance', range.cur.label, 'How the practice is doing for the dates you pick, compared with the period before and with last year. Green arrows are good news, red ones are worth a look.')}
${picker(range)}
${missingCallout(why)}
<section class="pn-kpis" aria-label="Key numbers">${cards.join('')}</section>
<h2 class="tdc-section-title">${esc(monthName)}, the rest of the month</h2>
<section class="pn-kpis pn-kpis-2" aria-label="Rest of the month">${rest}${projected}</section>
${tChart}`;
  return layout({ who, title: 'At a glance', current: '/', range, body });
}

// ------------------------------------------------------------------ Production

function productionPage({ who, range, cmp, provs, prevProvs, days, codes, counts }) {
  const c = cmp.cur;
  const avg = c.gross !== null && c.procCount ? c.gross / c.procCount : null;
  const pAvg = cmp.prev.gross !== null && cmp.prev.procCount ? cmp.prev.gross / cmp.prev.procCount : null;
  const lAvg = cmp.ly && cmp.ly.gross !== null && cmp.ly.procCount ? cmp.ly.gross / cmp.ly.procCount : (cmp.ly ? null : undefined);
  const cards = [
    kpi(trio(cmp, 'gross', { label: 'Gross production', icon: 'tooth', big: true, why: whyFor(c, ['production_by_provider']) }), range),
    kpi(trio(cmp, 'net', { label: 'Net production', big: true, why: whyFor(c, ['production_by_provider', 'adjustments_by_provider', 'writeoffs_by_provider']) }), range),
    kpi(trio(cmp, 'procCount', { label: 'Procedures completed', fmt: count, why: whyFor(c, ['production_by_provider']) }), range),
    kpi({ label: 'Average per procedure', value: avg, prev: pAvg, ly: lAvg, why: whyFor(c, ['production_by_provider']) }, range),
    kpi(trio(cmp, 'writeoffs', { label: 'Write-offs', goodWhenUp: false, why: whyFor(c, ['writeoffs_by_provider']) }), range),
    kpi(trio(cmp, 'adjustments', { label: 'Adjustments', why: whyFor(c, ['adjustments_by_provider']), sub: 'Discounts are negative' }), range),
  ];

  // By provider
  let provFig;
  if (!c.raw.prod.ok) provFig = naFigure('By provider', c.why.production_by_provider);
  else if (!provs.length) provFig = `<section class="pn-figure"><div class="pn-figcap"><span class="pn-figtitle">By provider</span></div>${emptyCard('No completed procedures', 'Nothing was completed in these dates.')}</section>`;
  else {
    const prevMap = new Map(prevProvs.map((p) => [p.provNum, p]));
    const items = provs.map((p) => ({ label: p.abbr, sub: p.name, values: [p.gross] }));
    provFig = figure({
      id: 'by-provider', title: 'By provider',
      wide: barChart({ title: 'Gross production by provider', items, series: [{ name: 'Gross production', cls: 'pn-s1' }] }),
      narrow: barChart({ width: 360, labelWidth: 120, valueWidth: 70, title: 'Gross production by provider', items, series: [{ name: 'Gross production', cls: 'pn-s1' }] }),
      table: table(['Provider', 'Gross', 'Adjustments', 'Write-offs', 'Net', 'Procedures', `Gross, ${range.prev.short}`, 'Change'],
        provs.map((p) => [`${esc(p.abbr)} <span class="tdc-muted">${esc(p.name)}</span>`, money(p.gross), money(p.adjustments), money(p.writeoffs), money(p.net), count(p.procs), prevMap.has(p.provNum) ? money(prevMap.get(p.provNum).gross) : money(0), chg(p.gross, prevMap.has(p.provNum) ? prevMap.get(p.provNum).gross : 0)]),
        { numCols: [1, 2, 3, 4, 5, 6, 7], foot: ['Total', money(c.gross), money(c.adjustments), money(c.writeoffs), money(c.net), count(c.procCount), money(cmp.prev.gross), chg(c.gross, cmp.prev.gross)] }),
      note: c.raw.adj.ok && c.raw.wo.ok ? '' : 'Net is shown once adjustments and write-offs are available.',
    });
  }

  // By day / week / month
  let dayFig;
  if (!days.ok) dayFig = naFigure('By day', days.why);
  else {
    const unit = days.buckets[0] ? days.buckets[0].unit : 'day';
    const title = { day: 'By day', week: 'By week', month: 'By month' }[unit];
    const lab = (b) => (unit === 'day' ? dayShort(b.from) : unit === 'week' ? `Week of ${dayShort(b.from)}` : b.label);
    const shown = days.buckets.filter((b) => unit !== 'day' || b.amount > 0 || ![0, 6].includes(new Date(`${b.from}T12:00:00Z`).getUTCDay()));
    const max = Math.max(...shown.map((b) => b.amount));
    dayFig = figure({
      id: 'by-day', title,
      wide: columnChart({ title: `Gross production ${title.toLowerCase()}`, items: shown.map((b) => ({ label: unit === 'day' ? b.label.replace(/^[A-Z][a-z]{2} /, '') : b.label, values: [b.amount], highlight: b.amount === max && max > 0 })), series: [{ name: 'Gross production', cls: 'pn-s1' }] }),
      narrow: barChart({ width: 360, labelWidth: 96, valueWidth: 64, title: `Gross production ${title.toLowerCase()}`, items: shown.filter((b) => b.amount > 0).map((b) => ({ label: unit === 'day' ? dayShort(b.from) : b.label, values: [b.amount] })), series: [{ name: 'Gross production', cls: 'pn-s1' }] }),
      table: table([unit === 'day' ? 'Day' : unit === 'week' ? 'Week' : 'Month', 'Gross production', 'Procedures'], shown.map((b) => [esc(lab(b)), money(b.amount), count(b.procs)]), { numCols: [1, 2], foot: ['Total', money(shown.reduce((s, b) => s + b.amount, 0)), count(shown.reduce((s, b) => s + b.procs, 0))] }),
      note: unit === 'day' ? 'Weekends with nothing completed are left out. The busiest day is outlined.' : `Long ranges are grouped by ${unit}.`,
    });
  }

  // By procedure code
  let codeFig;
  if (!codes.ok) codeFig = naFigure('By procedure code', codes.why);
  else if (!codes.rows.length) codeFig = `<section class="pn-figure"><div class="pn-figcap"><span class="pn-figtitle">By procedure code</span></div>${emptyCard('No completed procedures', 'Nothing was completed in these dates.')}</section>`;
  else {
    const total = c.gross || codes.rows.reduce((s, r) => s + r.amount, 0);
    const top = codes.rows.slice(0, 12);
    codeFig = figure({
      id: 'by-code', title: 'By procedure code (top 25)',
      wide: barChart({ title: 'Production by procedure code', labelWidth: 260, items: top.map((r) => ({ label: r.code, sub: trunc(r.descript, 30), values: [r.amount] })), series: [{ name: 'Production', cls: 'pn-s1' }] }),
      narrow: barChart({ width: 360, labelWidth: 132, valueWidth: 64, title: 'Production by procedure code', items: top.map((r) => ({ label: r.code, sub: trunc(r.descript, 18), values: [r.amount] })), series: [{ name: 'Production', cls: 'pn-s1' }] }),
      table: table(['Code', 'Description', 'Count', 'Production', 'Share'], codes.rows.map((r) => [`<span class="pn-num">${esc(r.code)}</span>`, esc(r.descript), count(r.qty), money(r.amount), total ? pct(r.amount / total) : '—']), { numCols: [2, 3, 4] }),
      note: 'The chart shows the top 12; the table shows the top 25.',
    });
  }

  // Procedure counts for the codes Ryan watches (setting COUNT_CODES).
  let countsSec = '';
  if (counts && (counts.rows || []).length) {
    countsSec = `<section class="pn-figure"><div class="pn-figcap"><span class="pn-figtitle">Procedures I watch</span></div><div class="tdc-table-wrap">${table(['Code', 'Description', 'Count', range.prev.short, 'Change'], counts.rows.map((r) => [`<span class="pn-num">${esc(r.code)}</span>`, esc(r.descript || ''), count(r.qty), r.prev === null ? '—' : count(r.prev), r.prev === null ? '—' : chg(r.qty, r.prev)]), { numCols: [2, 3, 4] })}</div><p class="pn-note">Codes come from the COUNT_CODES setting.</p></section>`;
  } else if (counts && !counts.ok) countsSec = naFigure('Procedures I watch', counts.why);

  const body = `${pagehead('tooth', 'Production', range.cur.label, 'Completed procedures by provider, by day and by procedure code. Net production is gross less adjustments and write-offs.')}
${picker(range)}
${missingCallout(mergeWhy(c.why, days.ok ? null : { production_by_day: days.why }, codes.ok ? null : { production_by_code: codes.why }, counts && !counts.ok ? { procedure_counts: counts.why } : null))}
<section class="pn-kpis" aria-label="Key numbers">${cards.join('')}</section>
${provFig}
${dayFig}
${codeFig}
${countsSec}`;
  return layout({ who, title: 'Production', current: '/production', range, body });
}
function trunc(s, n) { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

// ------------------------------------------------------------------ Collections

function collectionsPage({ who, range, cmp, provs }) {
  const c = cmp.cur;
  const cards = [
    kpi(trio(cmp, 'collections', { label: 'Collections', icon: 'dollar', big: true, why: whyFor(c, ['patient_payments_by_provider', 'insurance_payments_by_provider']) }), range),
    kpi(trio(cmp, 'rate', { label: 'Collection rate', big: true, fmt: (x) => pct(x), why: whyFor(c, ['patient_payments_by_provider', 'insurance_payments_by_provider', 'adjustments_by_provider', 'writeoffs_by_provider']), meter: c.rate === null ? undefined : Math.min(c.rate, 1), meterStatus: rateStatus(c.rate), sub: c.rate !== null ? `<span class="pn-num">${money(c.collections)}</span> ÷ <span class="pn-num">${money(c.net)}</span> net production` : 'Collections ÷ net production' }), range),
    kpi(trio(cmp, 'patient', { label: 'Patient payments', why: whyFor(c, ['patient_payments_by_provider']) }), range),
    kpi(trio(cmp, 'insurance', { label: 'Insurance payments', why: whyFor(c, ['insurance_payments_by_provider']) }), range),
  ];
  const series = [{ name: 'Patient payments', cls: 'pn-s3' }, { name: 'Insurance payments', cls: 'pn-s2' }];
  let provFig;
  if (!c.raw.pat.ok && !c.raw.ins.ok) provFig = naFigure('By provider', whyFor(c, ['patient_payments_by_provider', 'insurance_payments_by_provider']));
  else {
    const list = provs.filter((p) => p.patient || p.insurance || p.net);
    const items = list.map((p) => ({ label: p.abbr, sub: p.name, values: [c.raw.pat.ok ? p.patient : null, c.raw.ins.ok ? p.insurance : null] }));
    provFig = list.length ? figure({
      id: 'coll-provider', title: 'By provider', series,
      wide: barChart({ title: 'Payments by provider', items, series }),
      narrow: barChart({ width: 360, labelWidth: 110, valueWidth: 70, title: 'Payments by provider', items, series }),
      table: table(['Provider', 'Patient', 'Insurance', 'Collections', 'Net production', 'Rate'], list.map((p) => [`${esc(p.abbr)} <span class="tdc-muted">${esc(p.name)}</span>`, money(p.patient), money(p.insurance), money(p.collections), money(p.net), p.net ? pct(p.collections / p.net) : '—']), { numCols: [1, 2, 3, 4, 5], foot: ['Total', money(c.patient), money(c.insurance), money(c.collections), money(c.net), pct(c.rate)] }),
      note: 'Payments are counted by payment date, under the provider they were applied to.',
    }) : `<section class="pn-figure"><div class="pn-figcap"><span class="pn-figtitle">By provider</span></div>${emptyCard('No payments', 'No payments were entered in these dates.')}</section>`;
  }
  let splitFig = '';
  if (c.patient !== null && c.insurance !== null && c.collections) {
    const rows = [['Patient payments', c.patient, cmp.prev.patient, 'pn-s3'], ['Insurance payments', c.insurance, cmp.prev.insurance, 'pn-s2']];
    const items = rows.map(([l, v, , cls]) => ({ label: l, sub: pct(v / c.collections) + ' of collections', values: [v], cls }));
    splitFig = figure({
      id: 'coll-split', title: 'Where the money came from',
      wide: barChart({ title: 'Patient and insurance payments', labelWidth: 220, items, series: [{ name: 'Payments', cls: 'pn-s3' }] }),
      narrow: barChart({ width: 360, labelWidth: 150, valueWidth: 70, title: 'Patient and insurance payments', items, series: [{ name: 'Payments', cls: 'pn-s3' }] }),
      table: table(['Source', 'Amount', 'Share', range.prev.short, 'Change'], rows.map(([l, v, pv]) => [esc(l), money(v), pct(v / c.collections), money(pv), chg(v, pv)]), { numCols: [1, 2, 3, 4], foot: ['Collections', money(c.collections), '100%', money(cmp.prev.collections), chg(c.collections, cmp.prev.collections)] }),
    });
  }

  const body = `${pagehead('dollar', 'Collections', range.cur.label, 'Patient and insurance payments, by payment date. The collection rate is collections divided by net production for the same dates.')}
${picker(range)}
${missingCallout(c.why)}
<section class="pn-kpis" aria-label="Key numbers">${cards.join('')}</section>
${splitFig}
${provFig}`;
  return layout({ who, title: 'Collections', current: '/collections', range, body });
}

// ------------------------------------------------------------------ A/R

function arPage({ who, range, ar, cmp, lists }) {
  const t = ar.totals;
  const cards = [];
  if (t) {
    const over90 = t.total > 0 ? t.b3 / t.total : 0;
    cards.push(kpi({ label: 'Total A/R', icon: 'dollar', big: true, value: t.total, sub: `Insurance estimate <span class="pn-num">${money(t.insEst)}</span> · patient portion <span class="pn-num">${money(t.total - t.insEst)}</span>` }, null));
    cards.push(kpi({ label: 'Over 90 days', icon: 'alert', big: true, value: t.b3, meter: over90, meterStatus: over90 > 0.2 ? 'alert' : over90 > 0.1 ? 'warn' : 'ok', sub: `<span class="pn-num">${pct(over90)}</span> of all A/R` }, null));
  } else cards.push(kpi({ label: 'Total A/R', value: null, why: ar.why.ar_aging_totals }, null));
  if (ar.claims) cards.push(kpi({ label: 'Outstanding claims', icon: 'truck', value: ar.claims.fee, sub: `<span class="pn-num">${count(ar.claims.count)}</span> claims sent, not paid · expected <span class="pn-num">${money(ar.claims.est)}</span>` }, null));
  else cards.push(kpi({ label: 'Outstanding claims', value: null, why: ar.why.outstanding_claims }, null));
  if (ar.unsent) cards.push(kpi({ label: 'Unsent claims', icon: 'pending', value: ar.unsent.fee, sub: `<span class="pn-num">${count(ar.unsent.count)}</span> claims: <span class="pn-num">${ar.unsent.byStatus.U}</span> unsent, <span class="pn-num">${ar.unsent.byStatus.W}</span> waiting, <span class="pn-num">${ar.unsent.byStatus.H}</span> on hold` }, null));
  else cards.push(kpi({ label: 'Unsent claims', value: null, why: ar.why.unsent_claims }, null));

  const bucketNames = ['0–30 days', '31–60 days', '61–90 days', 'Over 90 days'];
  const aCls = ['pn-a0', 'pn-a1', 'pn-a2', 'pn-a3'];
  let agingFig;
  if (!t) agingFig = naFigure('Aging', ar.why.ar_aging_totals);
  else {
    const vals = [t.b0, t.b1, t.b2, t.b3];
    const tot = vals.reduce((a, b) => a + b, 0);
    agingFig = figure({
      id: 'aging', title: 'Aging',
      wide: agingColumns(vals, bucketNames, aCls),
      narrow: barChart({ width: 360, labelWidth: 100, valueWidth: 70, title: 'A/R aging', items: vals.map((v, i) => ({ label: bucketNames[i], values: [v], cls: aCls[i] })), series: [{ name: 'Balance', cls: 'pn-s1' }] }),
      table: table(['Age', 'Balance', 'Share'], vals.map((v, i) => [esc(bucketNames[i]), money2(v), tot ? pct(v / tot) : '—']).concat([['Credit balances', money2(t.credits), ''], ['Insurance estimate', money2(t.insEst), '']]), { numCols: [1, 2], foot: ['Total A/R', money2(t.total), ''] }),
      note: 'Family balances from Open Dental\'s stored aging (as of its last aging run). Credit balances are already included in the total.',
    });
  }
  let claimsFig;
  if (!ar.claims) claimsFig = naFigure('Outstanding claims by age', ar.why.outstanding_claims);
  else {
    const b = ar.claims.buckets;
    claimsFig = figure({
      id: 'claims-age', title: 'Outstanding claims by days since sent',
      wide: agingColumns(b.map((x) => x.fee), bucketNames, aCls, b.map((x) => `${x.count} claims`)),
      narrow: barChart({ width: 360, labelWidth: 100, valueWidth: 70, title: 'Outstanding claims by age', items: b.map((x, i) => ({ label: bucketNames[i], sub: `${x.count} claims`, values: [x.fee] })), series: [{ name: 'Claim fees', cls: 'pn-s1' }] }),
      table: table(['Days since sent', 'Claims', 'Billed', 'Insurance expected'], b.map((x, i) => [esc(bucketNames[i]), count(x.count), money(x.fee), money(x.est)]), { numCols: [1, 2, 3], foot: ['Total', count(ar.claims.count), money(ar.claims.fee), money(ar.claims.est)] }),
    });
  }

  // The range applies to money collected (aging and claims are "right now").
  const c = cmp.cur;
  const rangeCards = [
    kpi(trio(cmp, 'collections', { label: 'Collected in these dates', why: whyFor(c, ['patient_payments_by_provider', 'insurance_payments_by_provider']) }), range),
    kpi(trio(cmp, 'insurance', { label: 'Insurance paid in these dates', why: whyFor(c, ['insurance_payments_by_provider']) }), range),
  ];

  const listBtns = lists ? `<h2 class="tdc-section-title">Names</h2>
<p class="pn-note">These lists name patients, so they open only when you tap, and they aren't saved anywhere. They don't show on the Dashboard.</p>
<div class="tdc-btn-row pn-listbtns">
<button type="button" class="tdc-btn" data-list="families" aria-controls="pn-list" ${t ? '' : 'disabled'}><span data-icon="list"></span>Families with a balance</button>
<button type="button" class="tdc-btn" data-list="outstanding" aria-controls="pn-list" ${ar.claims ? '' : 'disabled'}><span data-icon="truck"></span>Outstanding claims</button>
<button type="button" class="tdc-btn" data-list="unsent" aria-controls="pn-list" ${ar.unsent ? '' : 'disabled'}><span data-icon="pending"></span>Unsent claims</button>
</div>
<div id="pn-list" class="pn-list" aria-live="polite"></div>` : '';

  const body = `${pagehead('clock', 'A/R and claims', 'as of now', 'Money owed to the practice right now, by age, and insurance claims that are out or not sent yet. The dates you pick apply to the collections cards.')}
${picker(range, 'Aging and claims are always as of right now.')}
${missingCallout(mergeWhy(ar.why, c.why))}
<section class="pn-kpis" aria-label="Key numbers">${cards.join('')}</section>
${agingFig}
${claimsFig}
<h2 class="tdc-section-title">Collections, ${esc(range.cur.short)}</h2>
<section class="pn-kpis pn-kpis-2" aria-label="Collections in these dates">${rangeCards.join('')}</section>
${listBtns}`;
  return layout({ who, title: 'A/R', current: '/ar', range, body });
}

/** Four aging columns, each in its own status colour, values on top. */
function agingColumns(vals, names, cls, subs) {
  const W = 900; const H = 260; const T = 30; const B = subs ? 48 : 34; const L = 20; const R = 20;
  const ph = H - T - B; const slot = (W - L - R) / vals.length; const bw = Math.min(slot * 0.6, 120);
  const max = Math.max(1e-9, ...vals.map((v) => Math.abs(v)));
  const out = [`<svg class="pn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aging" preserveAspectRatio="xMidYMid meet">`];
  vals.forEach((v, i) => {
    const h = (Math.max(0, v) / max) * ph; const x = L + i * slot + (slot - bw) / 2; const y = T + ph - h;
    if (h > 0) out.push(`<rect class="pn-bar ${cls[i]}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3"><title>${esc(`${names[i]}: ${money(v)}`)}</title></rect>`);
    out.push(`<text class="pn-val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle">${esc(money(v))}</text>`);
    out.push(`<text class="pn-xlab pn-xlab-strong" x="${(x + bw / 2).toFixed(1)}" y="${H - (subs ? 28 : 12)}" text-anchor="middle">${esc(names[i])}</text>`);
    if (subs) out.push(`<text class="pn-xlab" x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(subs[i])}</text>`);
  });
  out.push(`<line class="pn-base" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/></svg>`);
  return out.join('');
}

// ------------------------------------------------------------------ errors

function pausedPage({ who, message }) {
  const body = `${pagehead('alert', 'Numbers are paused', '')}
<div class="tdc-callout" data-status="alert" role="alert"><span data-icon="alert"></span><div><strong>Practice Numbers isn't showing anything right now</strong>${esc(message)}</div></div>`;
  return layout({ who, title: 'Paused', current: '', range: null, body, scripts: false }).replace(/<nav class="tdc-stats"[\s\S]*?<\/nav>/, '');
}
function notAllowedPage({ who }) {
  const body = `${pagehead('alert', 'Not allowed', '')}<div class="tdc-empty"><p>Practice Numbers is for owners and admins</p>Ask the owner if you need these numbers.</div>`;
  return layout({ who, title: 'Not allowed', current: '', range: null, body, scripts: false }).replace(/<nav class="tdc-stats"[\s\S]*?<\/nav>/, '');
}
function notFoundPage({ who }) {
  return layout({ who, title: 'Not found', current: '', range: null, body: '<div class="tdc-empty"><p>Page not found</p>Pick a page from the tiles above.</div>', scripts: false });
}

module.exports = { glancePage, productionPage, collectionsPage, arPage, pausedPage, notAllowedPage, notFoundPage, PAGES, REPORT_NAMES, SHORT_WHY };
