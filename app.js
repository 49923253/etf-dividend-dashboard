/* ETF 配息儀表板 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  rows: [],
  filtered: [],
  // Default sort for “one-glance” experience
  sortKey: 'exDividendDate',
  sortDir: 'asc',
  source: 'data.json',
};

function cleanText(s){
  if(s == null) return '';
  return String(s)
    // normalize whitespace (including fullwidth space)
    .replace(/[\u3000\s]+/g, ' ')
    // remove zero-width chars
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

// Make ETF names "one-glance": remove legal boilerplate; keep brand + index/theme.
// If still too long, apply middle-ellipsis.
function shortFundName(name){
  let s = cleanText(name);
  if(!s) return '';

  // If umbrella fund wording exists, keep the last segment after "之".
  // e.g. "...傘型...基金之 新光富時...ETF證券投資信託基金" -> "新光富時...ETF證券投資信託基金"
  if(s.includes('之')){
    const parts = s.split('之').map(x=>x.trim()).filter(Boolean);
    if(parts.length >= 2) s = parts[parts.length-1];
  }

  // Remove common legal suffixes / boilerplate
  const drops = [
    '證券投資信託基金',
    '證券投資信託事業',
    '證券投資信託',
    '投資信託基金',
    '投信基金',
    '傘型',
  ];
  for(const d of drops){
    s = s.replaceAll(d, '');
  }

  // Normalize ETF wording: keep one ETF and add "基金" if it ends up empty.
  s = s.replaceAll('ＥＴＦ','ETF');
  s = s.replace(/ETF+/g,'ETF');

  // Clean leftover connectors
  s = s.replace(/\s+/g,' ').trim();
  s = s.replace(/^基金/, '').replace(/基金$/, '');

  // Many official sites end with "ETF基金"; we keep that style if ETF present.
  if(s.includes('ETF') && !s.endsWith('ETF基金')){
    // If it already ends with ETF, append 基金
    if(s.endsWith('ETF')) s = s + '基金';
    else if(s.endsWith('ETF基金') === false) {
      // no-op; some names don't want extra suffix
    }
  }

  // If still too long, shrink with middle ellipsis (keeps recognition at both ends)
  const max = 26;
  if(s.length > max){
    const head = s.slice(0, 12);
    const tail = s.slice(-12);
    s = head + '…' + tail;
  }
  return s;
}

function parseDate(s){
  if(!s) return null;
  const d = new Date(s + 'T00:00:00');
  return Number.isNaN(+d) ? null : d;
}
function fmtDate(s){
  if(!s) return '—';
  return s;
}

function fmtExDiv(r){
  if(r?.dividendPolicy === 'no_dividend') return '無配息';
  if(r?.exDividendDate) return r.exDividendDate;
  if(r?.estimatedAnnounceDate && r?.estimatedExDividendDate){
    return `尚未公告（預估 ${r.estimatedAnnounceDate} 公告；預估 ${r.estimatedExDividendDate} 除息）`;
  }
  if(r?.estimatedAnnounceDate){
    return `尚未公告（預估 ${r.estimatedAnnounceDate} 公告）`;
  }
  return '尚未公告';
}
function daysUntil(dateStr){
  const d = parseDate(dateStr);
  if(!d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 86400000);
  return diff;
}
function freqLabel(v){
  switch(v){
    case 'no_dividend': return '不配息';
    case 'monthly': return '月配';
    case 'quarterly': return '季配';
    case 'semiannual': return '半年配';
    case 'annual': return '年配';
    default: return '—';
  }
}
function badgeForRow(r){
  if(r?.dividendPolicy === 'no_dividend') return {cls:'badge', text:'無配息'};
  const du = daysUntil(r?.exDividendDate);
  if(du === null) return {cls:'badge', text:'尚未公告'};
  if(du < 0) return {cls:'badge', text:'已除息'};
  if(du === 0) return {cls:'badge warn', text:'今天除息'};
  if(du <= 7) return {cls:'badge warn', text:'即將除息'};
  return {cls:'badge', text:`${du} 天後`};
}

async function load(){
  state.source = $('#dataSource').value;
  let data;
  try{
    const res = await fetch(state.source, {cache:'no-store'});
    data = await res.json();
  }catch(e){
    // Fallback to sample if data.json is missing (e.g., first run)
    if(state.source !== 'data.sample.json'){
      state.source = 'data.sample.json';
      $('#dataSource').value = 'data.sample.json';
      const res2 = await fetch(state.source, {cache:'no-store'});
      data = await res2.json();
    }else{
      throw e;
    }
  }

  state.rows = (Array.isArray(data) ? data : []).map(x => {
    const fullName = cleanText(x.name);
    const displayName = cleanText(x.shortName) || shortFundName(fullName);

    // Hide past ex-dividend dates (user only cares about future).
    const ex = cleanText(x.exDividendDate);
    const du = daysUntil(ex);
    const ex2 = (du != null && du < 0) ? null : (ex || null);

    return {
      ...x,
      ticker: cleanText(x.ticker),
      name: fullName,
      displayName,
      note: cleanText(x.note),
      exDividendDate: ex2,
      _ex: parseDate(ex2),
      _rec: parseDate(x.recordDate),
      _pay: parseDate(x.payDate),
    };
  });

  apply();
}

function apply(){
  const q = ($('#q').value || '').trim().toLowerCase();
  const onlyUpcoming = $('#onlyUpcoming').checked;
  const withinDays = Number($('#withinDays').value || 30);
  const onlyQuarterly = $('#onlyQuarterly').checked;
  const onlyTech = $('#onlyTech').checked;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  state.filtered = state.rows.filter(r => {
    const hay = `${r.ticker||''} ${r.name||''} ${r.displayName||''}`.toLowerCase();
    if(q && !hay.includes(q)) return false;

    if(onlyQuarterly && r.distributionFrequency !== 'quarterly') return false;
    if(onlyTech && !r.isTech) return false;

    if(onlyUpcoming){
      const d = r._ex;
      if(!d) return false;
      const du = Math.round((d - today)/86400000);
      if(du < 0) return false;
      if(Number.isFinite(withinDays) && withinDays > 0 && du > withinDays) return false;
    }

    return true;
  });

  sort();
  render();
}

function sort(){
  const key = state.sortKey;
  const dir = state.sortDir === 'asc' ? 1 : -1;

  const get = (r) => {
    if(key === 'ticker') return r.ticker || '';
    if(key === 'name') return r.name || '';
    if(key === 'price') return (r.price ?? -1);
    if(key === 'distributionFrequency') return r.distributionFrequency || 'unknown';
    if(key === 'isTech') return r.isTech ? 1 : 0;
    if(key === 'exDividendDate') return r._ex ? +r._ex : 9e15;
    if(key === 'recordDate') return r._rec ? +r._rec : 9e15;
    if(key === 'payDate') return r._pay ? +r._pay : 9e15;
    return '';
  };

  state.filtered.sort((a,b)=>{
    const av = get(a), bv = get(b);
    if(typeof av === 'number' && typeof bv === 'number') return (av-bv)*dir;
    return String(av).localeCompare(String(bv), 'zh-Hant')*dir;
  });
}

function render(){
  // KPIs
  const total = state.rows.length;
  const shown = state.filtered.length;
  const upcoming7 = state.filtered.filter(r => {
    const du = daysUntil(r.exDividendDate);
    return du !== null && du >= 0 && du <= 7;
  }).length;
  $('#kTotal').textContent = total;
  $('#kShown').textContent = shown;
  $('#kSoon').textContent = upcoming7;

  // Hint
  $('#hint').textContent = `資料來源：${state.source} · 顯示 ${shown}/${total}`;

  // Desktop table
  const tbody = $('#tbody');
  tbody.innerHTML = '';
  for(const r of state.filtered){
    const tr = document.createElement('tr');
    const badge = badgeForRow(r);
    tr.innerHTML = `
      <td><strong>${escapeHtml(r.ticker||'')}</strong></td>
      <td title="${escapeHtml(r.name||'')}">${escapeHtml(r.displayName||r.name||'')}</td>
      <td style="text-align:right">${r.price==null?'—':Number(r.price).toFixed(2)}</td>
      <td>${wrapBadge(badge)}</td>
      <td>${fmtExDiv(r)}</td>
      <td>${fmtDate(r.recordDate)}</td>
      <td>${fmtDate(r.payDate)}</td>
      <td>${freqLabel(r.distributionFrequency)}</td>
      <td>${chips(r)}</td>
      <td class="small note" title="${escapeHtml(r.note||'')}">${escapeHtml(r.note||'')}</td>
    `;
    tbody.appendChild(tr);
  }

  // Mobile cards: one glance, no horizontal scroll, no extra controls
  renderCards();
}

function renderCards(){
  const el = $('#cards');
  if(!el) return;
  el.innerHTML = '';

  for(const r of state.filtered){
    const du = daysUntil(r.exDividendDate);
    const badge = badgeForRow(r);

    const card = document.createElement('div');
    card.className = 'card-row compact';

    const duText = (du == null) ? '—' : (du < 0 ? '已除息' : (du === 0 ? '今天' : `D-${du}`));

    // Compact by default: keep “one glance” info only.
    // Detail fields (record/pay/note) stay available in the desktop table.
    card.innerHTML = `
      <div class="card-top">
        <div class="left">
          <div class="card-ticker">${escapeHtml(r.ticker||'')}</div>
          <div class="card-name" title="${escapeHtml(r.name||'')}">${escapeHtml(r.displayName||r.name||'')}</div>
        </div>
        <div>${wrapBadge(badge)}</div>
      </div>

      <div class="card-meta compact">
        <div class="item"><div class="k">除息日</div><div class="v">${fmtDate(r.exDividendDate)}</div></div>
        <div class="item"><div class="k">距離</div><div class="v">${duText}</div></div>
        <div class="item"><div class="k">股價</div><div class="v">${r.price==null?'—':Number(r.price).toFixed(2)}</div></div>
      </div>

      <div class="card-tags">${chips(r)}</div>
    `;

    el.appendChild(card);
  }
}

function stripHtml(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').trim() || '—';
}

function chips(r){
  const parts = [];
  if(r.distributionFrequency === 'quarterly') parts.push('<span class="chip q">季配</span>');
  if(r.isTech) parts.push('<span class="chip tech">科技股</span>');
  if(!parts.length) return '<span class="small">—</span>';
  return `<div class="chips">${parts.join('')}</div>`;
}
function wrapBadge(b){
  return `<span class="${b.cls}">${escapeHtml(b.text)}</span>`;
}
function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function wire(){
  $('#reload').addEventListener('click', load);
  $('#apply').addEventListener('click', apply);
  $('#q').addEventListener('input', () => apply());
  $('#onlyUpcoming').addEventListener('change', apply);
  $('#withinDays').addEventListener('change', apply);
  $('#onlyQuarterly').addEventListener('change', apply);
  $('#onlyTech').addEventListener('change', apply);
  $('#dataSource').addEventListener('change', load);

  // sortable headers (desktop)
  $$('#t thead th[data-k]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-k');
      if(state.sortKey === k){
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      }else{
        state.sortKey = k;
        state.sortDir = 'asc';
      }
      sort();
      render();
      updateSortHint();
    });
  });
  updateSortHint();
}

function updateSortHint(){
  const map = {
    ticker:'代號', name:'名稱', price:'股價', exDividendDate:'除息日', recordDate:'評價日', payDate:'發放日', distributionFrequency:'配息頻率', isTech:'科技'
  };
  $('#sortHint').textContent = `排序：${map[state.sortKey] || state.sortKey}（${state.sortDir==='asc'?'升冪':'降冪'}）`;
}

wire();
load().catch(err => {
  console.error(err);
  $('#hint').textContent = '讀取資料失敗：' + String(err);
});
