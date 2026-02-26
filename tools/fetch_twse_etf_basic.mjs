// Fetch TWSE OpenAPI ETF basic list and emit etf-dividend-dashboard/data.json
// Node >= 18
// Usage:
//   node tools/fetch_twse_etf_basic.mjs
//
// Notes:
// - This script uses TWSE OpenAPI endpoint: /v1/opendata/t187ap47_L (基金基本資料彙總表)
// - It builds a best-effort ETF universe + names. Price/dividend dates are not provided by this endpoint.
// - Output schema matches etf-dividend-dashboard/data.schema.md

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_PATH = path.join(process.cwd(), 'data.json');
const URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L';

function normStr(v){
  if(v == null) return '';
  return String(v).trim();
}

function isLikelyEtf(row){
  // Columns are Chinese in TWSE response. Be defensive.
  const type = normStr(row['基金類型']);
  const name = normStr(row['基金名稱']);
  const idx = normStr(row['標的指數|追蹤指數名稱']);
  // Heuristics: many ETFs have type containing ETF / 指數股票型 / 受益憑證
  return /ETF|指數股票型|受益/.test(type) || /ETF/.test(name) || /ETF|指數/.test(idx);
}

async function main(){
  const res = await fetch(URL, { headers: { 'accept': 'application/json' } });
  if(!res.ok){
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if(!Array.isArray(data)){
    throw new Error('Unexpected response: not an array');
  }

  const rows = data
    .filter(isLikelyEtf)
    .map((row) => {
      const ticker = normStr(row['基金代號']);
      const name = normStr(row['基金名稱']);

      return {
        ticker,
        name,
        price: null,
        currency: 'TWD',
        exDividendDate: null,
        recordDate: null,
        payDate: null,
        distributionFrequency: 'unknown',
        isTech: false,
        note: 'TWSE:基金基本資料彙總表（待補：股價/配息日期/季配/科技標註）'
      };
    })
    .filter(r => r.ticker && r.name);

  // de-dup by ticker
  const map = new Map();
  for(const r of rows){
    if(!map.has(r.ticker)) map.set(r.ticker, r);
  }

  const out = Array.from(map.values()).sort((a,b)=>a.ticker.localeCompare(b.ticker, 'en'));
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

  console.log(`Wrote ${out.length} ETFs -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
