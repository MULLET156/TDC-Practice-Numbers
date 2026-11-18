/* Practice Numbers page script (a file: the Dashboard blocks inline scripts).
   - Chart | Table switch on every chart (remembered on this device)
   - Date range picker: clean addresses, Custom dates
   - A/R page: patient lists load only after a tap, are never saved, and are
     cleared when you leave the page. */
(function () {
  'use strict';
  document.documentElement.classList.add('pn-js');
  var base = document.body.getAttribute('data-base') || '';

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* not available */ } return null; }

  // ---- Chart | Table ----
  function setView(fig, view) {
    fig.setAttribute('data-view', view);
    fig.querySelectorAll('.pn-view button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false'); });
  }
  var saved = store('pn-view');
  document.querySelectorAll('.pn-figure[data-view]').forEach(function (fig) {
    if (saved === 'table') setView(fig, 'table');
    fig.querySelectorAll('.pn-view button').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view');
        setView(fig, v);
        store('pn-view', v);
      });
    });
  });

  // ---- Date range picker ----
  var form = document.querySelector('.pn-range');
  if (form) {
    var custom = form.querySelector('.pn-custom-btn');
    if (form.getAttribute('data-range') === 'custom') form.classList.add('pn-open');
    custom.addEventListener('click', function () {
      var open = form.classList.toggle('pn-open');
      custom.setAttribute('aria-pressed', open || form.getAttribute('data-range') === 'custom' ? 'true' : 'false');
      if (open) { var f = form.querySelector('input[name="from"]'); if (f) f.focus(); }
    });
    form.addEventListener('submit', function (e) {
      var btn = e.submitter;
      var key = btn && btn.value;
      if (!key) return;
      e.preventDefault();
      var q = '';
      if (key === 'custom') {
        var from = form.querySelector('input[name="from"]').value;
        var to = form.querySelector('input[name="to"]').value;
        if (!from || !to) return;
        q = '?range=custom&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
      } else if (key !== 'mtd') q = '?range=' + encodeURIComponent(key);
      location.href = location.pathname + q;
    });
  }

  // ---- Patient lists (A/R page) ----
  var box = document.getElementById('pn-list');
  if (!box) return;
  var buttons = document.querySelectorAll('.pn-listbtns [data-list]');
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var SPECS = {
    families: { title: 'Families with a balance', cols: [['Family', 'name'], ['0–30', 'b0', 1], ['31–60', 'b1', 1], ['61–90', 'b2', 1], ['Over 90', 'b3', 1], ['Insurance est.', 'insEst', 1], ['Total', 'total', 1]] },
    outstanding: { title: 'Outstanding claims', cols: [['Patient', 'name'], ['Carrier', 'carrier'], ['Service', 'service', 'd'], ['Sent', 'sent', 'd'], ['Days', 'daysOut', 'n'], ['Type', 'type'], ['Billed', 'fee', 1], ['Expected', 'est', 1]] },
    unsent: { title: 'Unsent claims', cols: [['Patient', 'name'], ['Carrier', 'carrier'], ['Service', 'service', 'd'], ['Status', 'status'], ['Type', 'type'], ['Billed', 'fee', 1]] },
  };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function clear() { while (box.firstChild) box.removeChild(box.firstChild); buttons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); }
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function render(which, data) {
    var spec = SPECS[which];
    var sec = el('section', 'pn-figure');
    var cap = el('div', 'pn-figcap');
    cap.appendChild(el('span', 'pn-figtitle', spec.title + ' (' + data.rows.length + ')'));
    var hide = el('button', 'tdc-btn', 'Hide'); hide.type = 'button'; hide.addEventListener('click', clear);
    cap.appendChild(hide);
    sec.appendChild(cap);
    if (!data.rows.length) { var em = el('div', 'tdc-empty'); em.appendChild(el('p', '', 'Nothing here')); em.appendChild(document.createTextNode('There are no ' + spec.title.toLowerCase() + ' right now.')); sec.appendChild(em); box.appendChild(sec); return; }
    var wrap = el('div', 'tdc-table-wrap');
    var t = el('table', 'tdc-table pn-table');
    var tr = el('tr');
    spec.cols.forEach(function (c) { var th = el('th', c[2] ? 'pn-r' : '', c[0]); th.scope = 'col'; tr.appendChild(th); });
    var thead = el('thead'); thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    data.rows.forEach(function (r) {
      var row = el('tr');
      spec.cols.forEach(function (c, i) {
        var v = r[c[1]];
        var txt = c[2] === 1 ? money.format(v || 0) : c[2] === 'd' ? fmtDate(v) : c[2] === 'n' ? String(v) : String(v == null ? '' : v);
        var cell = el(i === 0 ? 'th' : 'td', c[2] && c[2] !== 'd' ? 'pn-r pn-num' : (c[2] === 'd' ? 'pn-num' : ''), txt);
        if (i === 0) cell.scope = 'row';
        if (c[1] === 'daysOut' && v > 90) cell.style.color = 'var(--tdc-alert)';
        row.appendChild(cell);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); sec.appendChild(wrap);
    if (data.truncated) sec.appendChild(el('p', 'pn-note', 'Only the first rows are shown.'));
    box.appendChild(sec);
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-list');
      var wasOpen = b.getAttribute('aria-pressed') === 'true';
      clear();
      if (wasOpen) return;
      b.setAttribute('aria-pressed', 'true');
      var wait = el('p', 'pn-note', 'Loading…'); box.appendChild(wait);
      fetch(base + '/api/list/' + which, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          clear(); b.setAttribute('aria-pressed', 'true');
          if (!x.ok) { box.appendChild(el('div', 'tdc-empty', x.d && x.d.error ? x.d.error : 'Not responding')); return; }
          render(which, x.d);
        })
        .catch(function () { clear(); box.appendChild(el('div', 'tdc-empty', 'Not responding. Try again in a minute.')); });
    });
  });
  // Names don't linger: cleared when you leave the page (and not kept in the back/forward cache).
  window.addEventListener('pagehide', clear);
})();
