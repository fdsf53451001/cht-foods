# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

「中華電信總公司附近美食地圖」—— 範圍鎖定中華電信總公司（台北市中正區信義路一段 21-3 號）步行 800 m 內。資料來自 OpenStreetMap（透過 Overpass API），不打 Google API、不需要使用者輸入 API Key。前端是 vanilla JS + Leaflet，無 build step。UI 全部 zh-TW。

部署目標是 GitHub Pages（規劃中），目前倉庫仍保留早期 Cloud Run / Docker / nginx 那套檔案，等切到 Pages 時再清理。

## Architecture

### 兩階段資料流
1. **離線一次性抓資料**：`node scripts/fetch-places.js` 打 Overpass API → 套啟發式分類 → 解析 opening_hours → 套 `data/overrides.json` 覆寫 → 寫入 `data/places.json`（檢入 git）。
2. **執行期前端**：`index.html` + `app.js` + `style.css` 直接 `fetch('data/places.json')`，**完全不打外部 API**。Leaflet + OSM tile 顯示底圖。

這個切分是刻意的：使用者開網頁不會打 Overpass、不會踩 fair-use 限制、載入速度只取決於 JSON 大小（目前 ~340 筆，幾百 KB）。要更新資料就是「重跑 script + 重新部署」。

### 啟發式分類規則（在 `scripts/fetch-places.js`）
- **價位**（`price_tier`）：`under_200` / `over_200` / `unknown`，靠規則疊加判斷：
  - 店名 keyword（`NAME_PRICEY` / `NAME_CHEAP` regex）
  - cuisine tag（OSM 英文 tag 或被填中文，兩種都檢查 —— `classifyPriceTier` 會走兩輪 regex + Set lookup）
  - amenity / shop fallback（`AMENITY_TIER` / `SHOP_TIER`）
  - 都不匹配 → `unknown`，前端歸到「其他」chip
- **時段**（`meal_times`）：`breakfast` / `lunch` / `dinner`，由 `parseOpeningHours` → `deriveMealTimes` 產出。和時段窗口（早 06:00–10:30、午 11:00–14:00、晚 17:00–21:00）至少重疊 30 分鐘才算。
- **fallback**：opening_hours 缺失（OSM 約 76% 沒填）時 `inferMealTimesFallback` 依店家類型猜時段，並把該筆標 `meal_times_inferred: true`，前端列表會顯示「推估」標記。
- **cuisine 翻譯**：`CUISINE_ZH` 對照表把 OSM 英文 tag（`taiwanese`、`bubble_tea`、`sushi`…）翻成中文。

### opening_hours parser
`parseOpeningHours` 是一個簡化版實作，**只支援常見格式**：`24/7`、`Mo-Fr 11:00-21:00`、`Mo-Sa 11:30-14:00,17:30-21:00`、多段以 `;` 分隔。不支援 PH（國定假日）、年度範圍、條件式語法 —— 失敗時整筆退回 fallback。如果看到時段判斷錯，先看 `opening_hours_raw` 有沒有特殊語法。

### overrides
`data/overrides.json` 的 `by_id` 是手動修正：key = `node/12345` 或 `way/67890`（同 places.json 的 `id`），value 是要覆寫的欄位（任何欄位皆可）。在 fetch-places script 跑完啟發式之後套用，被改過的會帶 `override_applied: true`。覆寫優先於啟發式。

### 前端 state machine（`app.js`）
全部狀態集中在頂部的 `state` 物件。每次 chip / search / checkbox 變動都呼叫 `applyFilters()` → `sortFiltered()` → `render()`。Filter 順序：
1. keyword（fuzzy match `name + cuisine + cuisine_raw + address`）
2. 時段（`'now'` 看當下 wall-clock 對應到哪個 meal window；`'any'` 不過濾；其他直接比對 `meal_times`）
3. 價位（`'other'` = `over_200` ∪ `unknown`）
4. 「現在營業中」勾選用 `isOpenAt(place, dayKey, minutesNow)`，沒有 `schedule` 的店家直接被濾掉（因為無從證明）

地圖 marker 顏色按 `price_tier` 染：綠（200 以下）／橘（其他）／灰（未知）。`focusPlace` 雙向綁定列表卡片與 marker。

### Mobile bottom sheet
保留原專案的三段式拖拉 panel（`PANEL_MIN/DEFAULT/MAX_HEIGHT` = 15/50/70vh），由 `initBottomSheet()` 啟動。桌面（≥ 768 px）改成左側固定 sidebar（CSS 處理），JS resize handler 清除 inline `height` 讓樣式接管。

## Common commands

無 lint / 無 test runner，依賴只有一個：Node 18+（用原生 `fetch`）。

- **重抓資料**：`npm run fetch-places`（== `node scripts/fetch-places.js`）。要 5–10 秒，會印統計表。
- **本地預覽**：`python3 -m http.server 8765`（root）然後開 `http://127.0.0.1:8765/`。Leaflet 從 unpkg CDN 載。
- **舊 Cloud Run 部署**：`./deploy.sh` 仍可用，但目標是改走 GitHub Pages，不應再投資這條路。

## Known caveats

- **31 家便利商店**會被當成餐飲一起列出（OSM 有 `shop=convenience` tag）。如果想排除，移除 `scripts/fetch-places.js` 的 `convenience` 即可。
- **31% 店家價位仍 unknown**（96 / 338，更新規則後降到 79）。剩下大多是 `amenity=restaurant` 但 OSM 沒填 cuisine、店名也不匹配關鍵字的。改善路徑：擴充 `NAME_CHEAP` regex，或寫進 `overrides.json`。
- **76% 店家沒有 `opening_hours`**：時段是 fallback 推估的，「現在營業中」勾選會把這些全濾掉（無從證實）。若需要「合理推估也算」要改 `isOpenAt` 邏輯。
- **CDN 依賴**：Leaflet 1.9.4 從 unpkg 載入，離線環境用不了。要做 PWA 或自託管要把 leaflet.js / leaflet.css 拉進 repo。
