// Launch Radar — radar-11 dashboard. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, the stat strip, the
// accounting bar, the evidence tables and a per-protocol detail view.
// No network: every byte it shows is in data.js. The verdicts, nets and
// farm plans are the ones main.ts computed for each row's own plan; the
// sliders below are display-only scenario controls and change nothing.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', verdict: 'all', tier: 'all',
    sort: 'rank', dir: 1, selected: null, drop: 7, horizon: 12, deposit: 500
  };
  var pinned = new Set();

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtMoney2(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + n.toFixed(2);
  }
  function fmtSigned(n) {
    var r = Math.round(n);
    return r >= 0 ? '$' + r.toLocaleString('en-US') : '-$' + Math.abs(r).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  // Age in years once a protocol is a year old, in days before that.
  function formatAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365.25).toFixed(1) + ' yr';
    return Math.max(0, Math.round(days)) + ' d';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  // ---- integrity: recompute the six checks from the data file itself ----
  function fnv1aHex(str) {
    var bytes = new TextEncoder().encode(str);
    var hash = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      hash = hash ^ bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
  function integrityChecks() {
    var rows = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
    var input = rows.map(function (r) { return r.slug + '|' + r.rank + '|' + r.impliedValueUsd; }).join('\n');
    var total = 0;
    rows.forEach(function (r) { total += r.impliedValueUsd; });
    var covered = rows.filter(function (r) { return r.watchlist; }).length;
    var ranksOk = rows.every(function (r, i) { return r.rank === i + 1; });
    var decOk = true;
    for (var i = 1; i < rows.length; i++) if (rows[i].impliedValueUsd >= rows[i - 1].impliedValueUsd) decOk = false;
    var ig = DATA.integrity || {};
    return [
      { label: 'checksum ' + (ig.checksum || '—'), ok: fnv1aHex(input) === ig.checksum },
      { label: 'total implied', ok: Math.round(total * 100) / 100 === ig.totalImplied },
      { label: 'watchlist ' + covered + '/' + (ig.watchlistTotal || 0), ok: covered === ig.watchlistCovered },
      { label: 'ranks 1..' + rows.length, ok: ranksOk },
      { label: 'implied decreasing', ok: decOk },
      { label: 'rows ' + rows.length, ok: rows.length === ig.rows }
    ];
  }

  // ---- header, lede, stat strip ----
  function header() {
    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.impliedValueUsd; }, 0);
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Launch Radar · ' + DATA.model })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.rows.length + ' rows' }),
        el('span', { text: 'Total implied ' + fmtUsd(totalImplied) })
      )
    );
  }
  function lede() {
    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.impliedValueUsd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by implied value' }),
        el('p', { text: 'Implied value is TVL × a fitted multiple × the chance a ticker is recorded for the protocol. The multiple and the odds are fitted from the snapshot\u2019s own priced protocols — no name is special-cased, no number is hardcoded. Model ' + DATA.model + ' · snapshot ' + DATA.as_of + '.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(totalImplied) })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols in the ledger' }), el('b', { text: String((DATA.accounting && DATA.accounting.total) || DATA.rows.length) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.rows.filter(function (r) { return r.watchlist; }).length + ' / 40' })),
        el('div', { class: 'fact' }, el('span', { text: 'Snapshot floor' }), el('b', { text: fmtUsd(DATA.floorUsd) }))
      )
    );
  }
  function statStrip() {
    var ev = DATA.evidence || {};
    var v = ev.value || {};
    var o = ev.odds || {};
    var rg = (ev.range && ev.range.rows) || [];
    var farm = 0, marg = 0, skip = 0;
    DATA.rows.forEach(function (r) { if (r.verdict === 'FARM') farm++; else if (r.verdict === 'MARGINAL') marg++; else skip++; });
    var keptValue = (v.terms || []).filter(function (t) { return t.kept === 'kept' || t.kept === 'baseline'; }).map(function (t) { return t.name; });
    var keptOdds = (o.terms || []).filter(function (t) { return t.kept === 'kept'; }).map(function (t) { return t.name; });
    var watch = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    var offList = DATA.rows.filter(function (r) { return r.parentName; }).length;
    var early = DATA.rows.length - watch - offList;
    function card(label, value, sub) {
      return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { text: value }), el('small', { text: sub }));
    }
    return el('div', { class: 'stats' },
      card('Out-of-sample miss', v.finalWf !== undefined ? '×' + v.finalWf.toFixed(2) : '—',
        'leave-one-out ×' + (v.finalLoo !== undefined ? v.finalLoo.toFixed(2) : '—') + ' · flat multiple ×' + (v.baselineWf !== undefined ? v.baselineWf.toFixed(2) : '—') + ' walk-forward'),
      card('Range honesty', rg.length >= 2 ? 'P25–P75 ' + Math.round(rg[0].wf * 100) + '% · P10–P90 ' + Math.round(rg[1].wf * 100) + '%' : '—',
        'stated 50% / 80% · leave-one-out ' + (rg.length >= 2 ? Math.round(rg[0].loo * 100) + '% / ' + Math.round(rg[1].loo * 100) + '%' : '—')),
      card('Token odds', o.finalWfBrier !== undefined ? 'Brier ' + o.finalWfBrier.toFixed(3) + ' walk-forward' : '—',
        'ten-fold ' + (o.finalBrier !== undefined ? o.finalBrier.toFixed(3) : '—') + ' · base rate ' + (o.baseRate !== undefined ? o.baseRate.toFixed(3) : '—') + ' · n=' + (o.n !== undefined ? o.n : '—')),
      card('Terms that survived', (keptValue.length) + ' value terms · ' + keptOdds.length + ' odds groups',
        keptValue.concat(keptOdds).join(' · ') || '—'),
      card('Worth farming', farm + ' FARM of ' + DATA.rows.length,
        marg + ' marginal · ' + skip + ' skip — net beats a T-bill and $25/hour'),
      card('Watchlist', watch + ' of 40 ranked',
        'plus ' + early + ' below the floor · ' + offList + ' off-list')
    );
  }

  // ---- accounting bar + integrity strip ----
  var ACCT_COLORS = ['#f2a93b', '#5b8def', '#3fbf7f', '#e5604f', '#9b7ede', '#e07fb0', '#4fc3c3', '#c9a227', '#7fb069'];
  function accountingSection() {
    var acct = DATA.accounting || { total: 0, groups: [] };
    var total = acct.total || 1;
    var bar = el('div', { class: 'acct-bar' });
    var legend = el('div', { class: 'legend' });
    (acct.groups || []).forEach(function (g, i) {
      var color = ACCT_COLORS[i % ACCT_COLORS.length];
      var seg = el('i', { style: 'width:' + Math.max(0, (g.count / total) * 100) + '%;background:' + color, title: g.label + ': ' + g.count });
      bar.appendChild(seg);
      legend.appendChild(el('span', null,
        el('span', { class: 'sw', style: 'background:' + color }),
        el('b', { text: String(g.count) }),
        document.createTextNode(' ' + g.label)
      ));
    });
    var chips = el('div', { class: 'chips' });
    integrityChecks().forEach(function (c) {
      chips.appendChild(el('span', { class: 'chip ' + (c.ok ? 'pass' : 'fail'), text: (c.ok ? 'PASS ' : 'FAIL ') + c.label }));
    });
    return el('section', { class: 'section' },
      el('h2', { text: 'Protocol accounting' }),
      el('p', { text: 'Every protocol in the snapshot lands in exactly one bucket, so the buckets always add up to the ledger total of ' + (acct.total || 0) + '.' }),
      bar, legend, chips
    );
  }

  // ---- evidence section ----
  function evidenceSection() {
    var ev = DATA.evidence || {};
    var v = ev.value || {};
    var o = ev.odds || {};
    function termTable(title, head, rows) {
      var table = el('table', null,
        el('thead', null, el('tr', null, head.map(function (h) { return el('th', { scope: 'col', text: h }); }))),
        el('tbody', null, rows.map(function (r) {
          return el('tr', null, r.map(function (cell, i) {
            if (i === r.length - 1) return el('td', { class: cell === 'kept' || cell === 'baseline' ? 'kept' : 'notkept', text: cell });
            return el('td', { class: 'num', text: cell });
          }));
        }))
      );
      return el('div', { class: 'evidence' }, el('h3', { text: title }), table);
    }
    var valueRows = (v.terms || []).map(function (t) {
      return [t.name, t.loo !== undefined ? '×' + t.loo.toFixed(4) : '—', t.wf !== undefined ? '×' + t.wf.toFixed(4) : '—', t.kept];
    });
    var oddsRows = (o.terms || []).map(function (t) {
      return [t.name, t.brier !== undefined ? t.brier.toFixed(4) : '—',
        t.wfBrier !== undefined ? t.wfBrier.toFixed(4) : '—',
        t.wfBrierAlt !== undefined ? t.wfBrierAlt.toFixed(4) : '—', t.kept];
    });
    var rangeRows = ((ev.range && ev.range.rows) || []).map(function (r) {
      return [r.label, Math.round(r.stated * 100) + '%', Math.round(r.loo * 100) + '%', Math.round(r.wf * 100) + '%', '—'];
    });
    var wfLine = 'Walk-forward Brier ' + (o.finalWfBrier !== undefined ? o.finalWfBrier.toFixed(3) : '—') +
      ' under the strict 4-block procedure · ' + (o.finalWfBrierAlt !== undefined ? o.finalWfBrierAlt.toFixed(3) : '—') +
      ' under the 3-block procedure (the one the published rival board\u2019s 0.215 matches). ' +
      'The 4-block number is the headline one and the only one the keep rule uses; the 3-block number is reported beside it because the walk-forward score moves with how the folds are built — ' +
      (o.walkForwardCorrectAlt !== undefined ? Math.round(o.walkForwardCorrectAlt * 100) + '%' : '—') + ' of 3-block test rows called right, against ' +
      (o.walkForwardCorrect !== undefined ? Math.round(o.walkForwardCorrect * 100) + '%' : '—') + ' under the strict procedure.';
    return el('section', { class: 'section' },
      el('h2', { text: 'Evidence' }),
      el('p', { text: 'How the model earned its terms. A term is kept only when it lowers the miss (value model) or the Brier score (odds model) in BOTH held-out tests — leave-one-out / ten-fold and the chronological walk-forward. The shuffled-growth control is tested and never kept.' }),
      termTable('Value model — miss factor (lower is better, n=' + (v.n !== undefined ? v.n : '—') + ' dated priced rows)',
        ['Term', 'Leave-one-out', 'Walk-forward', 'Kept'], valueRows),
      termTable('Token odds — Brier score (lower is better, n=' + (o.n !== undefined ? o.n : '—') + ', base rate ' + (o.baseRate !== undefined ? o.baseRate.toFixed(3) : '—') + ')',
        ['Group', 'Ten-fold', 'Walk-forward (4-block)', 'Walk-forward (3-block)', 'Kept'], oddsRows),
      el('p', { class: 'note', text: wfLine }),
      termTable('Range honesty — share of priced protocols whose real cap fell inside the band',
        ['Band', 'Stated', 'Leave-one-out', 'Walk-forward', ''], rangeRows),
      el('p', { class: 'note', text: (ev.range && ev.range.note) || '' })
    );
  }

  // ---- filtering, sorting, controls ----
  // A pinned row is exempt from every filter: it stays visible while pinned,
  // and the filter line shows how many rows are pinned. Sorting still applies.
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (pinned.has(r.slug)) return true;
      if (state.verdict !== 'all' && r.verdict.toLowerCase() !== state.verdict) return false;
      if (state.tier === 'watchlist' && !r.watchlist) return false;
      if (state.tier === 'early' && (r.watchlist || r.tvlUsd >= DATA.floorUsd)) return false;
      if (state.tier === 'offlist' && (r.watchlist || r.tvlUsd < DATA.floorUsd)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvlUsd; bv = b.tvlUsd; }
      else if (key === 'odds') { av = a.tokenOdds; bv = b.tokenOdds; }
      else if (key === 'implied') { av = a.impliedValueUsd; bv = b.impliedValueUsd; }
      else if (key === 'age') { av = a.ageDays === null ? Infinity : a.ageDays; bv = b.ageDays === null ? Infinity : b.ageDays; }
      else if (key === 'growth') { av = a.change7d === null ? -Infinity : a.change7d; bv = b.change7d === null ? -Infinity : b.change7d; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function tabButton(label, pressed, onclick) {
    return el('button', { type: 'button', 'aria-pressed': pressed ? 'true' : 'false', text: label, onclick: onclick });
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function dropdown(id, label, options, current, onchange) {
      var select = el('select', { id: id, 'aria-label': label });
      options.forEach(function (opt) {
        select.appendChild(el('option', { value: opt[0], text: opt[1], selected: opt[0] === current ? 'selected' : null }));
      });
      select.addEventListener('change', function () { onchange(select.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
    }
    var catOpts = [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; }));
    var chainOpts = [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; }));
    var sortOpts = [['rank', 'Rank'], ['implied', 'Implied value'], ['tvl', 'TVL'], ['odds', 'Token odds'], ['name', 'Name'], ['age', 'Age'], ['growth', '7-day change']];
    var deposit = el('input', { type: 'number', id: 'deposit', value: String(state.deposit), min: '100', max: '10000', step: '100', 'aria-label': 'Deposit in dollars' });
    deposit.addEventListener('input', function () { state.deposit = Number(deposit.value) || 500; updateScenario(); });
    var dropSlider = el('input', { type: 'range', id: 'drop', min: '1', max: '14', step: '0.5', value: String(state.drop), 'aria-label': 'Drop share percent' });
    var dropVal = el('span', { class: 'val', text: state.drop.toFixed(1) + '%' });
    dropSlider.addEventListener('input', function () { state.drop = Number(dropSlider.value); dropVal.textContent = state.drop.toFixed(1) + '%'; updateScenario(); });
    var hzSlider = el('input', { type: 'range', id: 'horizon', min: '4', max: '52', step: '1', value: String(state.horizon), 'aria-label': 'Horizon in weeks' });
    var hzVal = el('span', { class: 'val', text: state.horizon + ' wk' });
    hzSlider.addEventListener('input', function () { state.horizon = Number(hzSlider.value); hzVal.textContent = state.horizon + ' wk'; updateScenario(); });
    var verdictTabs = el('div', { class: 'tabs' },
      tabButton('All', state.verdict === 'all', function () { state.verdict = 'all'; render(); }),
      tabButton('Farm', state.verdict === 'farm', function () { state.verdict = 'farm'; render(); }),
      tabButton('Marginal', state.verdict === 'marginal', function () { state.verdict = 'marginal'; render(); }),
      tabButton('Skip', state.verdict === 'skip', function () { state.verdict = 'skip'; render(); }));
    var tierTabs = el('div', { class: 'tabs' },
      tabButton('All tiers', state.tier === 'all', function () { state.tier = 'all'; render(); }),
      tabButton('Watchlist', state.tier === 'watchlist', function () { state.tier = 'watchlist'; render(); }),
      tabButton('Early', state.tier === 'early', function () { state.tier = 'early'; render(); }),
      tabButton('Off-list', state.tier === 'offlist', function () { state.tier = 'offlist'; render(); }));
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.tier = 'all'; state.sort = 'rank'; state.dir = 1; writeHash(); render(); } });
    var csvBtn = el('button', { class: 'button', type: 'button', text: 'CSV', onclick: exportCsv });
    var jsonBtn = el('button', { class: 'button', type: 'button', text: 'JSON', onclick: exportJson });
    var count = el('span', { class: 'count', id: 'count' });
    return el('div', null,
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        dropdown('category', 'Category', catOpts, state.category, function (v) { state.category = v; }),
        dropdown('chain', 'Chain', chainOpts, state.chain, function (v) { state.chain = v; }),
        el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Verdict' }), verdictTabs),
        el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Tier' }), tierTabs),
        dropdown('sort', 'Sort', sortOpts, state.sort, function (v) { state.sort = v; state.dir = v === 'name' ? 1 : -1; }),
        reset, csvBtn, jsonBtn, count
      ),
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'deposit', text: 'Deposit ($)' }), deposit),
        el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Drop share' }), dropSlider, dropVal),
        el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Horizon' }), hzSlider, hzVal)
      ),
      el('div', { class: 'scenario', id: 'scenario' })
    );
  }
  function updateScenario() {
    var s = document.getElementById('scenario');
    if (!s) return;
    s.innerHTML = '';
    s.appendChild(el('span', null, 'Scenario: ',
      el('b', { text: fmtUsd(state.deposit) + ' deposit' }),
      document.createTextNode(' · ' + state.drop.toFixed(1) + '% drop · ' + state.horizon + ' weeks — display only; verdicts are costed on each row\u2019s own plan.')));
  }
  function updateCount() {
    var c = document.getElementById('count');
    if (!c) return;
    var n = filteredRows().length;
    c.textContent = n + ' rows shown' + (pinned.size > 0 ? ' · ' + pinned.size + ' pinned' : '');
  }

  // ---- board table ----
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.tier = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change7d === null ? 'n/a' : fmtPct(r.change7d);
      var growthClass = r.change7d === null ? '' : r.change7d >= 0 ? 'pos' : 'neg';
      var verdictClass = r.verdict === 'FARM' ? 'farm' : r.verdict === 'MARGINAL' ? 'marginal' : 'skip';
      var pin = el('input', { type: 'checkbox', 'aria-label': 'Pin ' + r.name, checked: pinned.has(r.slug) ? 'checked' : null });
      pin.addEventListener('change', function (e) {
        e.stopPropagation();
        if (pin.checked) pinned.add(r.slug); else pinned.delete(r.slug);
        render();
      });
      var pinCell = el('td', { onclick: function (e) { e.stopPropagation(); } }, pin);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: pinned.has(r.slug) ? 'pinned' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        pinCell,
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'num', text: r.bootstrapRankLow + '–' + r.bootstrapRankHigh }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          r.parentName ? el('span', { class: 'tag', text: 'Off-List · Parent ×0.48' }) : null
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvlUsd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: formatAge(r.ageDays) }),
        el('td', null, el('div', { class: 'odds-cell' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round(r.tokenOdds * 100)) + '%' })),
          el('span', { class: 'num', text: Math.round(r.tokenOdds * 100) + '%' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.valueIfLaunches) }),
        el('td', { class: 'num', text: fmtUsd(r.impliedValueUsd) }),
        el('td', { class: 'num', text: fmtUsd(r.p25) + '–' + fmtUsd(r.p75) }),
        el('td', null,
          el('div', { class: 'verdict ' + verdictClass, text: r.verdict + ' · ' + fmtSigned(r.netFees) }),
          el('div', { class: 'verdict-sub', text: fmtSigned(r.dropUsd) + ' drop − ' + fmtSigned(r.feesUsd) + ' fees' })
        ),
        el('td', { class: 'num', text: fmtMoney2(r.netPerHour) + '/hr' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. Pin a row to keep it visible through every filter.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col' }),
            sortHeader('rank', 'Rank'),
            el('th', { scope: 'col', text: 'Range' }),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Token odds'),
            el('th', { scope: 'col', text: 'If it launches' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'P25–P75' }),
            el('th', { scope: 'col', text: 'Verdict · net' }),
            el('th', { scope: 'col', text: 'Net / hour' })
          )),
          tbody
        )
      )
    );
  }

  // ---- exports ----
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvlUsd', 'change7d', 'ageDays', 'tokenOdds', 'valueIfLaunches', 'impliedValueUsd', 'p25', 'p75', 'verdict', 'netFees', 'netPerHour'];
    var lines = [head.join(',')];
    sortedRows(filteredRows()).forEach(function (r) {
      lines.push([r.rank, r.slug, r.name, r.category, (r.chains || []).join(';'), r.tvlUsd, r.change7d, r.ageDays, r.tokenOdds, r.valueIfLaunches, r.impliedValueUsd, r.p25, r.p75, r.verdict, r.netFees, r.netPerHour].map(csvCell).join(','));
    });
    download('launch-radar-radar-11.csv', lines.join('\n') + '\n', 'text/csv');
  }
  function exportJson() {
    download('launch-radar-radar-11.json', JSON.stringify(sortedRows(filteredRows()), null, 2) + '\n', 'application/json');
  }

  // ---- detail view ----
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var tbill = round2(row.depositUsd * 0.04 * (12 / 52));
    var beShare = row.impliedValueUsd > 0 && row.depositUsd > 0 && row.tvlUsd > 0
      ? (row.feesUsd * row.tvlUsd) / (row.impliedValueUsd * row.depositUsd) * 100 : 0;
    var beOdds = row.valueIfLaunches > 0 && row.depositUsd > 0 && row.tvlUsd > 0
      ? (row.feesUsd * row.tvlUsd) / (row.valueIfLaunches * 0.07 * row.depositUsd) * 100 : 0;
    var verdictClass = row.verdict === 'FARM' ? 'farm' : row.verdict === 'MARGINAL' ? 'marginal' : 'skip';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.rows.length + ' · bootstrap rank ' + row.bootstrapRankLow + '–' + row.bootstrapRankHigh }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.watchlist ? ' · watchlist' : ' · off-list') + (row.parentName ? ' · ' + row.parentName + ' (×0.48)' : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'big', text: fmtUsd(row.impliedValueUsd) }),
      el('div', { class: 'boxes' },
        el('div', { class: 'box' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvlUsd) })),
        el('div', { class: 'box' }, el('span', { text: '7-day change' }), el('b', { text: fmtPct(row.change7d) })),
        el('div', { class: 'box' }, el('span', { text: 'Token odds' }), el('b', { text: Math.round(row.tokenOdds * 100) + '%' })),
        el('div', { class: 'box' }, el('span', { text: 'Bootstrap range' }), el('b', { text: fmtUsd(row.bootstrapLow) + '–' + fmtUsd(row.bootstrapHigh) }))
      ),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Value if it launches' }), el('b', { text: fmtUsd(row.valueIfLaunches) })),
        el('div', null, el('span', { text: 'Fitted multiple' }), el('b', { text: '×' + row.factors.multiple.toFixed(4) })),
        el('div', null, el('span', { text: 'Size factor' }), el('b', { text: '×' + row.factors.size.toFixed(4) })),
        el('div', null, el('span', { text: 'Category factor' }), el('b', { text: '×' + row.factors.category.toFixed(4) })),
        el('div', null, el('span', { text: 'P25–P75' }), el('b', { text: fmtUsd(row.p25) + ' – ' + fmtUsd(row.p75) })),
        el('div', null, el('span', { text: 'P10–P90' }), el('b', { text: fmtUsd(row.p10) + ' – ' + fmtUsd(row.p90) })),
        el('div', null, el('span', { text: 'Listed' }), el('b', { text: row.ageDays === null ? 'date unknown' : 'listed ' + formatAge(row.ageDays) + ' ago' }))
      ),
      el('p', { class: 'sub', text: 'How the figure is made: TVL × the fitted multiple (size curve plus category effect, fitted on the dated priced protocols) × the listing probability (the chance a ticker is recorded — not the chance the token trades). The interval is the implied value shifted by the value model\u2019s own held-out residuals.' })
    ));
    var peerRows = (row.peers || []).map(function (p) {
      return el('tr', null,
        el('td', { text: p.name }),
        el('td', { class: 'num', text: fmtUsd(p.tvl) }),
        el('td', { class: 'num', text: fmtUsd(p.mcap) }),
        el('td', { class: 'num', text: p.ratio.toFixed(4) }),
        el('td', { class: 'num', text: p.heldOut.toFixed(4) })
      );
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Nearest priced peers' }),
      peerRows.length > 0
        ? el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Peer' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Ratio' }), el('th', { scope: 'col', text: 'Held-out' }))),
            el('tbody', null, peerRows))
        : el('p', { class: 'sub', text: 'No priced peer in this category.' }),
      el('p', { class: 'sub', text: 'Held-out is the leave-one-out model prediction over the peer\u2019s actual cap/TVL ratio — 1.00 means the model priced the peer exactly.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict' }),
      el('div', { class: 'verdict ' + verdictClass, text: row.verdict + ' · net ' + fmtSigned(row.netFees) }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Modelled drop (7% of implied)' }), el('b', { text: fmtMoney2(row.dropUsd) })),
        el('div', null, el('span', { text: 'Gas fees' }), el('b', { text: fmtMoney2(row.feesUsd) })),
        el('div', null, el('span', { text: 'Deposit' }), el('b', { text: fmtMoney2(row.depositUsd) })),
        el('div', null, el('span', { text: 'Hands-on time' }), el('b', { text: row.handsOnHours.toFixed(2) + ' h' })),
        el('div', null, el('span', { text: 'Net per hour' }), el('b', { text: fmtMoney2(row.netPerHour) + '/hr' })),
        el('div', null, el('span', { text: 'T-bill bar (12 wk, 4%)' }), el('b', { text: fmtMoney2(tbill) })),
        el('div', null, el('span', { text: 'Fees covered at drop share ≥' }), el('b', { text: beShare.toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Fees covered at listing odds ≥' }), el('b', { text: Math.min(100, Math.max(0, beOdds)).toFixed(1) + '%' }))
      ),
      el('p', { class: 'sub', text: 'FARM clears both bars — net above the T-bill and $25/hour for the farmer\u2019s time. MARGINAL nets above zero but clears neither fully. SKIP loses money to gas. ' + row.exitRule })
    ));
    var shares = [0.035, 0.07, 0.14];
    var deposits = [1000, 3000, 10000, 30000];
    var gridHead = el('tr', null, el('th', { scope: 'col', text: 'Drop share \\ deposit' }),
      deposits.map(function (d) { return el('th', { scope: 'col', text: fmtUsd(d) }); }));
    var gridBody = el('tbody');
    shares.forEach(function (share) {
      var cells = deposits.map(function (deposit) {
        var drop = row.tvlUsd > 0 ? round2((row.impliedValueUsd * share * deposit) / row.tvlUsd) : 0;
        var net = round2(drop - row.feesUsd);
        return el('td', { class: 'num ' + (net >= 0 ? 'pos' : 'neg'), text: fmtMoney2(net) });
      });
      gridBody.appendChild(el('tr', null, el('td', { class: 'num', text: (share * 100).toFixed(1) + '%' }), cells));
    });
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Net by drop share × deposit' }),
      el('table', { class: 'grid-net' }, el('thead', null, gridHead), gridBody),
      el('p', { class: 'sub', text: 'Net of the row\u2019s own gas fees at each drop share and deposit. The row\u2019s own plan uses a 7% drop share and a deposit of 0.02% of TVL.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farmPlan || []).map(function (s) {
        return el('li', null, el('b', { text: s.n + '. ' + s.title + ' — ' + s.text }), el('span', { class: 'cost', text: s.cost + ' · ' + s.time }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---- hash, render ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(statStrip());
    shell.appendChild(accountingSection());
    shell.appendChild(evidenceSection());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    updateScenario();
    updateCount();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
