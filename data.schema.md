# data.json 欄位說明

此專案用 JSON 陣列作為資料來源。

## 檔案格式

```json
[
  {
    "ticker": "00929",
    "name": "OOO ETF",
    "price": 18.52,
    "currency": "TWD",

    "exDividendDate": "2026-03-18",
    "recordDate": "2026-03-19",
    "payDate": "2026-04-15",

    "distributionFrequency": "quarterly",
    "isTech": true,

    "note": "可選：補充說明"
  }
]
```

## 欄位

- `ticker` (string, 必填)：ETF 代號
- `name` (string, 必填)：ETF 名稱
- `price` (number | null)：目前股價（可未知）
- `currency` (string)：預設 `TWD`

- `exDividendDate` (string | null)：除息日（YYYY-MM-DD）
- `recordDate` (string | null)：收益分配評價日/權益分配評價日（YYYY-MM-DD）
- `payDate` (string | null)：收益分配發放日（YYYY-MM-DD）

- `distributionFrequency` (string)：
  - `monthly` | `quarterly` | `semiannual` | `annual` | `unknown`
- `isTech` (boolean)：是否屬「科技股」主題（用於特別標註/篩選）
- `note` (string, optional)：備註

> 你若希望我自動判定「科技股」：可加 `theme` / `sectorFocus` / `holdings` 等欄位，我再寫規則。
