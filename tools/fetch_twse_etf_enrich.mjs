#!/usr/bin/env node
/**
 * Enrich etf-dividend-dashboard/data.json with real:
 * - exDividendDate / recordDate / payDate from TWSE ETF dividend endpoint
 * - price (close) from TWSE MI_INDEX afterTrading endpoint
 *
 * Sources:
 * - https://www.twse.com.tw/rwd/zh/ETF/etfDiv?response=json
 * - https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?type=ALLBUT0999&response=json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const OUT_PATH = path.resolve(ROOT, 'data.json');

function parseTwseYmdTw(s){
  // Example: "115年03月12日" (ROC year)
  if(!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{2,3})年(\d{2})月(\d{2})日$/);
  if(!m) return null;
  const roc = Number(m[1]);
  const y = roc + 1911;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if(!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  const iso = `${String(y).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  return iso;
}

function parseNum(s){
  if(s == null) return null;
  const t = String(s).trim();
  if(!t || t === '--' || t === '—') return null;
  const n = Number(t.replaceAll(',',''));
  return Number.isFinite(n) ? n : null;
}

function guessFrequency(name){
  const n = (name || '');
  if(/月配/.test(n)) return 'monthly';
  if(/季配/.test(n)) return 'quarterly';
  if(/半年配/.test(n)) return 'semiannual';
  if(/年配/.test(n)) return 'annual';
  return 'unknown';
}

function guessIsTech(name){
  const n = (name || '');
  return /(科技|半導體|AI|人工智慧|電腦|通訊|5G|IC|晶圓|電子|雲端|資安|網路|電動車|EV)/i.test(n);
}

async function fetchJson(url){
  const res = await fetch(url, {
    headers: {
      'user-agent': 'openclaw-etf-dashboard/1.0',
      'accept': 'application/json,text/plain,*/*',
    },
    cache: 'no-store',
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getEtfDivMap(){
  const url = 'https://www.twse.com.tw/rwd/zh/ETF/etfDiv?response=json';
  const j = await fetchJson(url);
  const rows = Array.isArray(j?.data) ? j.data : [];
  // Data row example (observed):
  // [代號, 名稱, 除息日, 評價日(基準日), 發放日, 每受益權單位分配金額?, 備註, 年度]
  // There can be multiple rows per ticker (history + future).
  const map = new Map();
  for(const r of rows){
    if(!Array.isArray(r) || r.length < 5) continue;
    const ticker = String(r[0]||'').trim();
    if(!ticker) continue;
    const ev = {
      ticker,
      name: String(r[1]||'').trim() || null,
      exDividendDate: parseTwseYmdTw(r[2]),
      recordDate: parseTwseYmdTw(r[3]),
      payDate: parseTwseYmdTw(r[4]),
      cashDividend: parseNum(r[5]),
      raw: r,
    };
    if(!map.has(ticker)) map.set(ticker, []);
    map.get(ticker).push(ev);
  }

  // Sort each ticker events by exDividendDate (ascending) when available
  for(const [t, arr] of map.entries()){
    arr.sort((a,b)=>String(a.exDividendDate||'').localeCompare(String(b.exDividendDate||''), 'en'));
  }

  return { url, map, count: map.size };
}

async function getClosePriceMap(){
  const url = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?type=ALLBUT0999&response=json';
  const j = await fetchJson(url);
  const tables = Array.isArray(j?.tables) ? j.tables : [];

  // MI_INDEX returns multiple tables. Some tickers may appear in different tables.
  // Merge all tables that contain (證券代號, 收盤價).
  const map = new Map();
  let mergedTables = 0;
  for(const t of tables){
    const fields = Array.isArray(t?.fields) ? t.fields : null;
    const data = Array.isArray(t?.data) ? t.data : null;
    if(!fields || !data || data.length === 0) continue;
    const codeIdx = fields.indexOf('證券代號');
    const closeIdx = fields.indexOf('收盤價');
    if(codeIdx === -1 || closeIdx === -1) continue;

    for(const row of data){
      if(!Array.isArray(row)) continue;
      const ticker = String(row[codeIdx]||'').trim();
      if(!ticker) continue;
      const close = parseNum(row[closeIdx]);
      if(close == null) continue;
      if(!map.has(ticker)) map.set(ticker, close);
    }
    mergedTables++;
  }

  return {
    url,
    map,
    count: map.size,
    mergedTables,
  };
}

async function main(){
  const raw = await fs.readFile(OUT_PATH, 'utf8');
  const rows = JSON.parse(raw);
  if(!Array.isArray(rows)) throw new Error('data.json is not an array');

  const [{map: divMap, url: divUrl, count: divCount}, {map: pxMap, url: pxUrl, count: pxCount, mergedTables}] = await Promise.all([
    getEtfDivMap(),
    getClosePriceMap(),
  ]);

  const todayIso = new Date().toISOString().slice(0,10);
  const isFutureOrToday = (iso) => iso && String(iso) >= todayIso;
  const isPast = (iso) => iso && String(iso) < todayIso;
  const addDays = (iso, days) => {
    if(!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if(Number.isNaN(+d)) return null;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
  };
  const daysBetween = (a,b) => {
    if(!a || !b) return null;
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    if(Number.isNaN(+da) || Number.isNaN(+db)) return null;
    return Math.round((db - da)/86400000);
  };
  const inferFreqFromCount = (cnt) => {
    if(cnt >= 10) return 'monthly';
    if(cnt >= 3 && cnt <= 5) return 'quarterly';
    if(cnt === 2) return 'semiannual';
    if(cnt === 1) return 'annual';
    return null;
  };

  let updated = 0;
  for(const r of rows){
    const t = String(r.ticker||'').trim();
    if(!t) continue;

    // price
    if(pxMap.has(t)){
      r.price = pxMap.get(t);
    }

    // dividend dates + (best-effort) official shorter name from TWSE etfDiv
    const evs = divMap.get(t) || [];

    // Decide whether it is a dividend-paying ETF
    const hasDividendEvents = evs.some(e => e.cashDividend != null || e.exDividendDate);

    // Only keep FUTURE ex-dividend date (what the user wants to see)
    const futureEvs = evs.filter(e => isFutureOrToday(e.exDividendDate));
    const nextEv = futureEvs.length ? futureEvs[0] : null;

    if(nextEv){
      r.exDividendDate = nextEv.exDividendDate;
      r.recordDate = nextEv.recordDate;
      r.payDate = nextEv.payDate;
    }else{
      // Do not show past ex-dividend date in the main column.
      if(isPast(r.exDividendDate)) r.exDividendDate = null;
    }

    // Use TWSE etfDiv name as official shortName when the stored name is too long.
    // etfDiv's name is typically the public-facing short name.
    const fullName = String(r.name || '').trim();
    const bestName = (nextEv?.name || evs[evs.length-1]?.name || '').trim();
    if(fullName && fullName.length > 20 && bestName && bestName.length < fullName.length){
      r.shortName = bestName;
    }

    // Frequency: infer from events in the last 365 days; fall back to name keywords.
    const oneYearAgo = addDays(todayIso, -365);
    const recentEx = evs
      .map(e => e.exDividendDate)
      .filter(d => d && d >= oneYearAgo && d <= todayIso)
      .sort();
    const inferred = inferFreqFromCount(recentEx.length);

    const kw = guessFrequency(r.name);

    if(hasDividendEvents || inferred || kw !== 'unknown'){
      r.dividendPolicy = 'dividend';
      r.distributionFrequency = inferred || (kw !== 'unknown' ? kw : 'annual');

      // If no future ex-date, estimate announce date (B mode: provide estimate)
      if(!r.exDividendDate){
        // Estimate next ex-div date based on last known ex date + frequency interval
        const lastEx = evs.map(e=>e.exDividendDate).filter(Boolean).sort().slice(-1)[0] || null;
        let interval = 90;
        if(r.distributionFrequency === 'monthly') interval = 30;
        else if(r.distributionFrequency === 'quarterly') interval = 90;
        else if(r.distributionFrequency === 'semiannual') interval = 182;
        else if(r.distributionFrequency === 'annual') interval = 365;

        const estEx = addDays(lastEx, interval);
        // Announce typically happens before ex-date; use conservative lead time.
        const lead = 10;
        const estAnn = estEx ? addDays(estEx, -lead) : null;
        r.estimatedExDividendDate = estEx;
        r.estimatedAnnounceDate = estAnn;
      }else{
        r.estimatedExDividendDate = null;
        r.estimatedAnnounceDate = null;
      }
    }else{
      r.dividendPolicy = 'no_dividend';
      r.distributionFrequency = 'no_dividend';
      r.exDividendDate = null;
      r.recordDate = null;
      r.payDate = null;
      r.estimatedExDividendDate = null;
      r.estimatedAnnounceDate = null;
    }

    // tech tag
    r.isTech = Boolean(r.isTech) || guessIsTech(r.name);

    // note about cashDividend if present (latest)
    const lastCash = evs.map(e=>e.cashDividend).filter(v=>v!=null).slice(-1)[0];
    if(lastCash != null){
      r.note = (r.note ? r.note + ' | ' : '') + `TWSE etfDiv 最近現金分配=${lastCash}`;
    }

    updated++;
  }

  // annotate top-level notes via per-row note (keep it simple)
  const stamp = `sources: etfDiv=${divUrl} (tickers=${divCount}); price=${pxUrl} (rows=${pxCount}, tables=${mergedTables})`;
  for(const r of rows){
    r.note = r.note ? `${r.note} | ${stamp}` : stamp;
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(rows, null, 2) + '\n', 'utf8');

  console.log(`Enriched ${updated} ETFs -> ${OUT_PATH}`);
  console.log(`Dividend rows: ${divCount} | Price rows: ${pxCount}`);
}

main().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
