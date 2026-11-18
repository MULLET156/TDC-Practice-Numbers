'use strict';
// Hand-built SVG charts (no chart libraries). Every value is printed on the
// chart itself, so nothing needs hover on a tablet, and every chart comes
// with a table of the same numbers (the page adds a Chart | Table switch).
// Colours come from the shared --tdc-* variables through classes in
// numbers.css, so light and dark mode both work.
//
// Wide screens get column charts; phones get horizontal bars, which keep
// the labels readable at 390px.

const { esc, moneyShort } = require('./fmt');

/** A "nice" step (1, 2, 2.5, 5 × 10^n) so four steps cover v. */
function niceStep(v) {
  if (!(v > 0)) return 1;
  const raw = v / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= raw) return m * exp;
  return 10 * exp;
}
function niceMax(v) { return niceStep(v) * 4; }
const f1 = (n) => Math.round(n * 10) / 10;

/**
 * Column chart.
 * items:  [{ label, values: [n, n, …], highlight? }]
 * series: [{ name, cls }]   (cls: pn-s1 accent, pn-s2 info, pn-s3 ok, pn-a0…pn-a3 aging)
 */
function columnChart({ items, series, fmt = moneyShort, title = '' }) {
  const W = 900; const H = 300; const L = 60; const R = 8; const T = series.length > 1 ? 44 : 28; const B = 34;
  const pw = W - L - R; const ph = H - T - B;
  const n = Math.max(items.length, 1);
  const top = Math.max(0, ...items.flatMap((it) => it.values.map((v) => v || 0)));
  const step = niceStep(top);
  const ticks = Math.max(1, Math.ceil(top / step));
  const max = step * ticks;
  const slot = pw / n;
  const group = Math.min(slot * 0.72, 90);
  const bw = group / series.length;
  const y = (v) => T + ph - (Math.max(0, v || 0) / max) * ph;
  const out = [];
  out.push(`<svg class="pn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">`);
  // Grid lines and axis labels.
  for (let i = 0; i <= ticks; i++) {
    const v = step * i; const yy = f1(y(v));
    out.push(`<line class="pn-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text class="pn-axis" x="${L - 6}" y="${f1(yy + 4)}" text-anchor="end">${esc(fmt(v))}</text>`);
  }
  // Which labels fit: value labels need ~44px, x labels ~46px.
  const labelEvery = Math.max(1, Math.ceil(52 / slot));
  const valueMode = slot >= 50 ? 'flat' : slot >= 14 ? 'turned' : 'none';
  const peak = Math.max(...items.map((it) => it.values[0] || 0));
  items.forEach((it, i) => {
    const gx = L + i * slot + (slot - group) / 2;
    it.values.forEach((v, s) => {
      const top = y(v); const h = T + ph - top;
      if (v > 0) out.push(`<rect class="pn-bar ${series[s].cls}${it.highlight ? ' pn-hl' : ''}" x="${f1(gx + s * bw)}" y="${f1(top)}" width="${f1(Math.max(bw - 2, 1))}" height="${f1(Math.max(h, 1))}" rx="2"><title>${esc(`${it.label} · ${series[s].name}: ${fmt(v)}`)}</title></rect>`);
    });
    const cx = gx + group / 2;
    const topV = Math.max(...it.values.map((v) => v || 0));
    if (valueMode === 'flat') {
      // One line per series, stacked above the tallest bar.
      it.values.forEach((v, s) => {
        if (v === null || v === undefined || v === 0) return;
        const yy = y(topV) - 6 - (it.values.length - 1 - s) * 15;
        out.push(`<text class="pn-val ${series[s].cls}" x="${f1(cx)}" y="${f1(yy)}" text-anchor="middle">${esc(fmt(v))}</text>`);
      });
    } else if (valueMode === 'turned' && (it.values[0] || 0) > 0) {
      const v = it.values[0]; const yy = y(v) - 5;
      out.push(`<text class="pn-val pn-turn ${series[0].cls}" transform="translate(${f1(cx + 3)},${f1(yy)}) rotate(-90)" text-anchor="start">${esc(fmt(v))}</text>`);
    } else if (valueMode === 'none' && (it.values[0] || 0) === peak && peak > 0) {
      out.push(`<text class="pn-val ${series[0].cls}" x="${f1(cx)}" y="${f1(y(peak) - 6)}" text-anchor="middle">${esc(fmt(peak))}</text>`);
    }
    if (i % labelEvery === 0) out.push(`<text class="pn-xlab" x="${f1(L + i * slot + slot / 2)}" y="${H - 12}" text-anchor="middle">${esc(it.label)}</text>`);
  });
  out.push(`<line class="pn-base" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>`);
  out.push('</svg>');
  return out.join('');
}

/**
 * Horizontal bars: one row per item, label on the left, value on the right.
 * Used for providers and codes everywhere, and for every chart on phones.
 * items:  [{ label, sub?, values: [n, …] }]
 */
function barChart({ items, series, fmt = moneyShort, title = '', width = 900, labelWidth = 200, valueWidth = 96 }) {
  const per = series.length;
  const barH = per > 1 ? 11 : 16;
  const rowH = per > 1 ? 16 + per * (barH + 3) : 34;
  const T = 6;
  const H = T + Math.max(items.length, 1) * rowH + 4;
  const x0 = labelWidth; const x1 = width - valueWidth - 6;
  const max = Math.max(1e-9, ...items.flatMap((it) => it.values.map((v) => Math.abs(v || 0))));
  const out = [`<svg class="pn-svg pn-hbars" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMin meet">`];
  items.forEach((it, i) => {
    const y0 = T + i * rowH;
    const midLabel = y0 + rowH / 2 + (it.sub ? -2 : 4);
    out.push(`<text class="pn-blab" x="0" y="${f1(midLabel)}">${esc(it.label)}</text>`);
    if (it.sub) out.push(`<text class="pn-bsub" x="0" y="${f1(midLabel + 14)}">${esc(it.sub)}</text>`);
    it.values.forEach((v, s) => {
      const by = per > 1 ? y0 + 8 + s * (barH + 3) : y0 + (rowH - barH) / 2;
      const w = (Math.abs(v || 0) / max) * (x1 - x0);
      out.push(`<rect class="pn-track" x="${x0}" y="${f1(by)}" width="${f1(x1 - x0)}" height="${barH}" rx="3"/>`);
      if (w > 0) out.push(`<rect class="pn-bar ${it.cls || series[s].cls}" x="${x0}" y="${f1(by)}" width="${f1(Math.max(w, 2))}" height="${barH}" rx="3"><title>${esc(`${it.label} · ${series[s].name}: ${fmt(v)}`)}</title></rect>`);
      out.push(`<text class="pn-bval ${per > 1 ? series[s].cls : ''}" x="${width}" y="${f1(by + barH - 2)}" text-anchor="end">${esc(v === null || v === undefined ? '—' : fmt(v))}</text>`);
    });
    if (i < items.length - 1) out.push(`<line class="pn-grid" x1="0" x2="${width}" y1="${f1(y0 + rowH)}" y2="${f1(y0 + rowH)}"/>`);
  });
  out.push('</svg>');
  return out.join('');
}

/** Legend under a chart: coloured key plus the series name (never colour alone). */
function legend(series) {
  if (series.length < 2) return '';
  return `<p class="pn-legend">${series.map((s) => `<span><i class="pn-key ${s.cls}" aria-hidden="true"></i>${esc(s.name)}</span>`).join('')}</p>`;
}

/**
 * A chart block with a Chart | Table switch (numbers.js toggles it; without
 * scripts both show). id must be unique on the page.
 */
function figure({ id, title, wide, narrow, table, series = [], note = '' }) {
  return `<figure class="pn-figure" id="${esc(id)}" data-view="chart">
<figcaption class="pn-figcap"><span class="pn-figtitle">${esc(title)}</span>
<span class="tdc-seg pn-view" role="group" aria-label="Show ${esc(title)} as"><button type="button" data-view="chart" aria-pressed="true">Chart</button><button type="button" data-view="table" aria-pressed="false">Table</button></span></figcaption>
<div class="pn-chartbox">${wide ? `<div class="${narrow ? 'pn-wide' : ''}">${wide}</div>` : ''}${narrow ? `<div class="pn-narrow">${narrow}</div>` : ''}${legend(series)}</div>
<div class="pn-tablebox tdc-table-wrap">${table}</div>
${note ? `<p class="pn-note">${note}</p>` : ''}
</figure>`;
}

module.exports = { columnChart, barChart, legend, figure, niceMax };
