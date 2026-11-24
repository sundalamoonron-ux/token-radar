// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
//
// The page is static and offline: no fetch, no network, no framework. The board
// sorts by column, filters by text, category, chain and watchlist, and opens a
// detail view for any row. The detail view shows the model's maths step by step
// and the protocol's farm plan, both straight from the same data as the board,
// so the screenshots and the code cannot disagree.
//
// Model (radar-2), as the page states it:
//   implied = tvl x categoryMultiple x growthMult x maturityMult x chainMult
//   categoryMultiple: the median market-cap / TVL of the live protocols in the
//   protocol's category (four or more live names), else the whole market's
//   median, clamped to [0.05, 1.00] — computed from the snapshot, never typed in.
//   growthMult: 1 + clamp(change_7d, -40, +80) / 100 x 0.6.
//   maturityMult: 0.55 + 0.45 x min(age_days, 730) / 730 (unknown age: 365 days).
//   chainMult: 1 + 0.02 x min(chains - 1, 5).

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !Array.isArray(DATA.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="7">No radar data: data.js did not load.</td></tr>';
    return;
  }

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var watchlist = {};
  (DATA.watchlist || []).forEach(function (s) { watchlist[s] = true; });

  // ------------------------------------------------------------ formatting

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function pct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    var cls = v > 0.5 ? 'up' : v < -0.5 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + s + '</span>';
  }

  function age(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------ meta + selects

  var meta = document.getElementById('meta');
  meta.innerHTML =
    '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>' +
    '<div><dt>Board</dt><dd>' + DATA.board_size + ' rows</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + DATA.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + DATA.early_size + '</dd></div>';

  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  var catSel = document.getElementById('category');
  cats.forEach(function (c) { catSel.add(new Option(c, c)); });
  var chainSel = document.getElementById('chain');
  chains.forEach(function (c) { chainSel.add(new Option(c, c)); });

  document.getElementById('source').textContent =
    'Source: DefiLlama protocols snapshot, as of ' + DATA.as_of + '. ' +
    'Floor: ' + money(DATA.floor_usd) + ' of TVL for the watchlist. ' +
    'Model ' + DATA.model_version + ': implied value from the snapshot’s own figures.';

  document.getElementById('method').innerHTML =
    'Each protocol’s implied value is <code>TVL × category multiple × growth × maturity × chains</code>. ' +
    'The category multiple is the median market-cap / TVL of the live protocols in that category. ' +
    'Growth is the 7-day TVL move, clamped to −40%…+80% and weighted 0.6. ' +
    'Maturity rises from 0.55 to 1.00 over a protocol’s first two years with no token. ' +
    'Each extra chain adds 2%, up to +10%.';

  // ------------------------------------------------------------ multiples + live

  var multBody = document.getElementById('multipleRows');
  (DATA.multiples || []).forEach(function (m) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + esc(m.category) + '</td>' +
      '<td class="num">' + m.live_sample + '</td>' +
      '<td class="num">' + (m.live_median === null ? '—' : m.live_median.toFixed(3)) + '</td>' +
      '<td class="num"><b>' + m.multiple.toFixed(3) + '</b></td>';
    multBody.appendChild(tr);
  });

  var liveBody = document.getElementById('liveRows');
  (DATA.live || []).forEach(function (p) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="name"><b>' + esc(p.name) + '</b><span>' + esc(p.slug) + (p.category ? ' · ' + esc(p.category) : '') + '</span></td>' +
      '<td class="num value">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td>';
    liveBody.appendChild(tr);
  });

  // ------------------------------------------------------------ board

  var state = { sortKey: 'rank', sortDir: 1, q: '', category: '', chain: '', watchlistOnly: false };
  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var noteEl = document.getElementById('boardNote');

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchlistOnly && !watchlist[r.slug]) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sorted(list) {
    var k = state.sortKey;
    var d = state.sortDir;
    return list.slice().sort(function (a, b) {
      var av = a[k];
      var bv = b[k];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return (av < bv ? -1 : av > bv ? 1 : 0) * d;
      return (av - bv) * d;
    });
  }

  function renderBoard() {
    var list = sorted(filtered());
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + (r.category ? ' · ' + esc(r.category) : '') + '</span>' +
        (watchlist[r.slug] ? '<span class="chip">watchlist</span>' : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num value">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">×' + r.multiple.toFixed(3) + '</td></tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="7">Nothing matches these filters.</td></tr>';
    countEl.textContent = list.length + ' of ' + rows.length + ' rows';
    noteEl.textContent = 'Ranked by implied value, highest first. A protocol’s token does not exist yet: the value is what it would be worth if the protocol’s record stayed as it is.';
    Array.prototype.forEach.call(document.querySelectorAll('#board thead th'), function (th) {
      th.textContent = th.textContent.replace(/ [▲▼]$/, '');
      if (th.getAttribute('data-sort') === state.sortKey) th.textContent += state.sortDir === 1 ? ' ▲' : ' ▼';
    });
  }

  // ------------------------------------------------------------ detail

  var detailSec = document.getElementById('detail');

  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) { detailSec.hidden = true; return; }
    document.getElementById('detailName').textContent = '#' + r.rank + ' · ' + r.name;
    var gross = r.tvl_usd * r.multiple;
    var body = '<dl>' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + age(r.age_days) + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + (r.chains || []).join(', ') + '</dd></div>' +
      '<div><dt>Category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '</dl>' +
      '<h3>How the price is built</h3>' +
      '<div class="math">' +
      'TVL ' + money(r.tvl_usd) + ' × ' + r.multiple.toFixed(3) + ' (category multiple) = <b>' + money(gross) + '</b><br>' +
      '× growth ' + r.growth_multiplier.toFixed(4) + ' (7d ' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%') + ')<br>' +
      '× maturity ' + r.maturity_multiplier.toFixed(4) + ' (' + age(r.age_days) + ' with no token)<br>' +
      '× chains ' + r.chain_multiplier.toFixed(4) + ' (' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ')<br>' +
      '= implied value <b>' + money(r.implied_value_usd) + '</b>' +
      '</div>' +
      '<h3>Farm plan — what to do about it</h3><ol class="steps">' +
      (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    document.getElementById('detailBody').innerHTML = body;
    detailSec.hidden = false;
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
  }

  // ------------------------------------------------------------ hash + events

  function readHash() {
    var h = window.location.hash || '';
    var m = h.match(/^#\/protocol\/([A-Za-z0-9._-]+)/);
    if (m) { showDetail(m[1]); return; }
    detailSec.hidden = true;
    if (h.indexOf('#/?') === 0) {
      var params = new URLSearchParams(h.slice(3));
      if (params.get('category')) { state.category = params.get('category'); catSel.value = state.category; }
      if (params.get('chain')) { state.chain = params.get('chain'); chainSel.value = state.chain; }
      if (params.get('q')) { state.q = params.get('q'); document.getElementById('q').value = state.q; }
      if (params.get('watchlist')) { state.watchlistOnly = true; document.getElementById('watchlistOnly').checked = true; }
    }
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.q) params.set('q', state.q);
    if (state.watchlistOnly) params.set('watchlist', '1');
    var s = params.toString();
    history.replaceState(null, '', s ? '#/?' + s : '#/');
  }

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); writeHash(); });
  catSel.addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); writeHash(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); writeHash(); });
  document.getElementById('watchlistOnly').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; renderBoard(); writeHash(); });
  document.getElementById('detailClose').addEventListener('click', function () { detailSec.hidden = true; history.replaceState(null, '', '#/'); });
  Array.prototype.forEach.call(document.querySelectorAll('#board thead th'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = k === 'rank' ? 1 : -1; }
      renderBoard();
    });
  });
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    history.replaceState(null, '', '#/protocol/' + tr.getAttribute('data-slug'));
    showDetail(tr.getAttribute('data-slug'));
    detailSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('hashchange', function () { readHash(); renderBoard(); });

  readHash();
  renderBoard();
})();
