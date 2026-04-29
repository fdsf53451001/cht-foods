#!/usr/bin/env node
// 抓取中華電信總公司步行範圍內的餐飲店家，套用啟發式分類，輸出 data/places.json。
// 零依賴，需要 Node 18+ 的原生 fetch。
//
// 用法：node scripts/fetch-places.js

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ============ 設定 ============
const CENTER = {
    lat: 25.0365622,
    lng: 121.5233031,
    label: '中華電信總公司（台北市中正區信義路一段 21-3 號）',
};
const RADIUS_M = 800;

// 時段定義（24h）
const MEAL_WINDOWS = {
    breakfast: [6 * 60, 10 * 60 + 30],
    lunch: [11 * 60, 14 * 60],
    dinner: [17 * 60, 21 * 60],
};
// 與時段窗口至少重疊這麼多分鐘，才算該時段有營業
const MEAL_OVERLAP_MIN = 30;

const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];

// ============ Overpass query ============
function buildQuery() {
    const c = `${CENTER.lat},${CENTER.lng}`;
    // 抓三組：
    // (1) amenity=食物相關
    // (2) shop=食物相關（含飲料、酒、市場）
    // (3) 任何標了 cuisine 的點（補抓沒標 amenity 但有 cuisine 的店家）
    return `[out:json][timeout:30];
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|biergarten|marketplace)$"](around:${RADIUS_M},${c});
  nwr["shop"~"^(bakery|deli|convenience|pastry|confectionery|tea|coffee|beverages|alcohol|chocolate|ice_cream)$"](around:${RADIUS_M},${c});
  nwr["cuisine"](around:${RADIUS_M},${c});
);
out center tags;`;
}

async function fetchOverpass() {
    const body = new URLSearchParams({ data: buildQuery() }).toString();
    let lastErr;
    for (const url of OVERPASS_ENDPOINTS) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'cht-foods-dev/0.1 (https://github.com/)',
                },
                body,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return json.elements ?? [];
        } catch (err) {
            lastErr = err;
            console.warn(`Overpass 端點失敗: ${url} (${err.message})，嘗試下一個…`);
        }
    }
    throw lastErr ?? new Error('All Overpass endpoints failed');
}

// ============ opening_hours 解析（簡化版） ============
// 支援常見格式：24/7、Mo-Fr 11:00-21:00、Mo-Sa 11:30-14:00,17:30-21:00、Mo-Fr 06:00-10:00; Sa 08:00-12:00
// 不支援：PH、年度範圍、條件式。失敗時回 null。
const DAY_INDEX = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function parseOpeningHours(raw) {
    if (!raw) return null;
    const text = raw.trim();
    if (!text) return null;
    if (/24\/7/.test(text)) {
        return Object.fromEntries(DAY_KEYS.map(d => [d, [[0, 1440]]]));
    }
    const schedule = Object.fromEntries(DAY_KEYS.map(d => [d, []]));
    const segments = text.split(/\s*;\s*/);
    let parsedAny = false;

    for (const seg of segments) {
        const s = seg.trim();
        if (!s || /off$/i.test(s) || /^PH/.test(s) || /^SH/.test(s)) continue;

        // 抽出第一段時間 token "HH:MM-HH:MM[,HH:MM-HH:MM]"
        const timeMatch = s.match(/(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*)/);
        if (!timeMatch) continue;
        const timeStr = timeMatch[1];
        const dayPart = s.slice(0, timeMatch.index).trim();
        const days = expandDays(dayPart);
        if (days.length === 0) continue;
        const ranges = parseTimeRanges(timeStr);
        if (ranges.length === 0) continue;
        for (const d of days) {
            for (const r of ranges) schedule[DAY_KEYS[d]].push(r);
        }
        parsedAny = true;
    }
    return parsedAny ? schedule : null;
}

function expandDays(part) {
    if (!part) return [0, 1, 2, 3, 4, 5, 6]; // 沒寫天 = 每天
    const result = new Set();
    for (const token of part.split(/\s*,\s*/)) {
        const t = token.trim();
        if (!t) continue;
        const range = t.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)$/);
        if (range) {
            const a = DAY_INDEX[range[1]];
            const b = DAY_INDEX[range[2]];
            if (a <= b) for (let i = a; i <= b; i++) result.add(i);
            else { for (let i = a; i < 7; i++) result.add(i); for (let i = 0; i <= b; i++) result.add(i); }
            continue;
        }
        if (DAY_INDEX[t] !== undefined) { result.add(DAY_INDEX[t]); continue; }
    }
    return [...result];
}

function parseTimeRanges(s) {
    const out = [];
    for (const part of s.split(/\s*,\s*/)) {
        const m = part.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!m) continue;
        const start = +m[1] * 60 + +m[2];
        let end = +m[3] * 60 + +m[4];
        if (end === 0) end = 1440;
        if (end <= start) end += 1440; // 跨夜
        out.push([start, Math.min(end, 1440 + 24 * 60)]);
    }
    return out;
}

function deriveMealTimes(schedule) {
    if (!schedule) return [];
    const meals = new Set();
    for (const day of DAY_KEYS) {
        for (const [s, e] of schedule[day]) {
            for (const [meal, [ms, me]] of Object.entries(MEAL_WINDOWS)) {
                const overlap = Math.min(e, me) - Math.max(s, ms);
                if (overlap >= MEAL_OVERLAP_MIN) meals.add(meal);
            }
        }
    }
    return [...meals];
}

// 沒有 opening_hours 時，依店家類型猜一個 fallback 時段，避免店家被時段 filter 全濾掉
function inferMealTimesFallback({ name, amenity, shop, cuisine }) {
    const text = `${name || ''} ${cuisine || ''}`;
    if (/(早餐|早午餐|brunch|豆漿|蛋餅|飯糰|燒餅|油條|永和|麥味登|拉亞)/i.test(text)) {
        return ['breakfast', 'lunch'];
    }
    if (/(宵夜|消夜|居酒|酒吧|bar|pub|燒烤)/i.test(text)) {
        return ['dinner'];
    }
    if (amenity === 'bar' || amenity === 'pub' || amenity === 'biergarten') return ['dinner'];
    if (amenity === 'cafe') return ['breakfast', 'lunch'];
    if (shop === 'bakery' || shop === 'pastry') return ['breakfast', 'lunch'];
    if (shop === 'convenience') return ['breakfast', 'lunch', 'dinner'];
    if (amenity === 'ice_cream') return ['lunch', 'dinner'];
    if (amenity === 'fast_food' || amenity === 'restaurant' || amenity === 'food_court') {
        return ['lunch', 'dinner'];
    }
    return ['lunch', 'dinner'];
}

// ============ cuisine 中文翻譯 ============
const CUISINE_ZH = {
    chinese: '中式', taiwanese: '台式', japanese: '日式', korean: '韓式',
    italian: '義式', french: '法式', thai: '泰式', vietnamese: '越式',
    american: '美式', indian: '印度', mexican: '墨西哥', spanish: '西班牙',
    mediterranean: '地中海', asian: '亞洲',
    pizza: '披薩', burger: '漢堡', sushi: '壽司', ramen: '拉麵',
    noodle: '麵食', dumpling: '餃類', bento: '便當', breakfast: '早餐',
    coffee_shop: '咖啡', bubble_tea: '手搖飲', tea: '茶飲',
    ice_cream: '冰品', dessert: '甜點', bakery: '烘焙',
    vegetarian: '素食', vegan: '純素', street_food: '小吃',
    hot_pot: '火鍋', barbecue: '燒烤', bbq: '燒烤',
    steak_house: '牛排', seafood: '海鮮', dim_sum: '港點',
    sandwich: '三明治', cake: '蛋糕', curry: '咖哩',
    fish_and_chips: '炸魚薯條', regional: '在地料理', international: '異國料理',
    pasta: '義大利麵', salad: '沙拉', soup: '湯品', friture: '炸物',
    fried_chicken: '炸雞', kebab: '烤肉串', donut: '甜甜圈',
    juice: '果汁', smoothie: '果昔',
};

function translateCuisine(raw) {
    if (!raw) return [];
    return raw.split(/[;,]/).map(s => {
        const key = s.trim().toLowerCase().replace(/\s+/g, '_');
        return CUISINE_ZH[key] ?? key;
    }).filter(Boolean);
}

// ============ 價位啟發式 ============
const NAME_CHEAP = /(便當|魯肉|滷肉|小吃|早餐|早午餐|brunch|飯糰|蛋餅|粥|水餃|鍋貼|餛飩|雲吞|肉羹|肉圓|魷魚羹|麵店|麵館|麵食|麵點|麵餃|餃店|麵|米粉|米線|炒飯|燴飯|烤肉飯|海南雞飯|雞飯|滷味|關東煮|刈包|包子|燒餅|油條|蘿蔔糕|三明治|吐司|車輪餅|雞排|鹹酥雞|串燒|串串|手搖|飲料|果汁|豆花|豆漿|冰店|冰品|冰菓|冰果|刨冰|湯包|小籠|蔥抓餅|蔥油餅|食堂|快餐|自助餐|餐盒|便利商店|超商|7-?ELEVEN|全家|萊爾富|OK超商|麥當勞|肯德基|摩斯|儂特利|鬍鬚張|頂呱呱|繼光香香雞|胖老爹|拉亞漢堡|麥味登|永和豆漿|清粥|小館|港點|港式|燒臘|鵝肉|鴨肉|鴨莊|魚丸|餅店|點心|烘焙|麵包|蛋糕|甜甜圈|貝果|可頌|飲冰室|茶店|咖啡)/i;
const NAME_PRICEY = /(鐵板燒|懷石|無菜單|割烹|燒肉|和牛|牛排館|海鮮樓|私廚|Fine\s*Dining|Bistro|Trattoria|Omakase|法式餐廳|義式餐廳|頂級|主廚)/i;

const AMENITY_TIER = {
    fast_food: 'under_200',
    cafe: 'under_200',
    ice_cream: 'under_200',
    food_court: 'under_200',
    bar: 'over_200',
    pub: 'over_200',
    biergarten: 'over_200',
};
const SHOP_TIER = {
    bakery: 'under_200', deli: 'under_200', convenience: 'under_200',
    pastry: 'under_200', confectionery: 'under_200',
};
const CUISINE_CHEAP = new Set([
    'breakfast', 'noodle', 'noodles', 'beef_noodle', 'dumpling', 'dumplings',
    'bento', 'street_food', 'sandwich', 'sandwiches',
    'bubble_tea', 'coffee_shop', 'donut', 'cake', 'ice_cream', 'fried_chicken',
    'curry', 'juice', 'smoothie', 'taiwanese', 'chinese', 'burger', 'pizza',
    'porridge', 'congee', 'soup', 'soup_dumpling', 'rice', 'fast_food',
    'tea', 'pancake', 'crepe', 'breakfast_brunch', 'regional',
]);
const CUISINE_PRICEY = new Set([
    'japanese', 'italian', 'french', 'sushi', 'steak_house', 'hot_pot',
    'seafood', 'dim_sum', 'kebab',
]);

// ============ 大類分類（前端 chip 用） ============
const BEVERAGE_CUISINE = new Set(['bubble_tea', 'juice', 'smoothie', 'tea']);

function classifyCategory({ amenity, shop, cuisine, name }) {
    // shop 優先
    if (shop === 'convenience') return 'convenience';
    if (['bakery', 'pastry', 'confectionery', 'deli', 'chocolate'].includes(shop)) return 'bakery';
    if (['tea', 'coffee', 'beverages', 'alcohol'].includes(shop)) return 'beverage';
    if (shop === 'ice_cream') return 'ice_cream';

    const cuisineList = (cuisine || '').toLowerCase().split(/[;,]/).map(s => s.trim()).filter(Boolean);
    const isBeverageByCuisine = cuisineList.some(c => BEVERAGE_CUISINE.has(c));

    // amenity
    switch (amenity) {
        case 'bar':
        case 'pub':
        case 'biergarten':
            return 'bar';
        case 'marketplace':
            return 'market';
        case 'food_court':
            return 'food_court';
        case 'ice_cream':
            return 'ice_cream';
        case 'cafe':
            // cafe 但 cuisine 是手搖飲類 → beverage
            return isBeverageByCuisine ? 'beverage' : 'cafe';
        case 'fast_food':
            return isBeverageByCuisine ? 'beverage' : 'fast_food';
        case 'restaurant':
            return 'restaurant';
    }

    // 沒 amenity / shop，但有 cuisine（cuisine fallback 抓進來的）
    if (isBeverageByCuisine) return 'beverage';
    if (cuisineList.length > 0) return 'restaurant';

    return 'other';
}

const CATEGORY_LABEL = {
    restaurant: '餐廳',
    fast_food: '小吃／快餐',
    cafe: '咖啡',
    bakery: '烘焙甜點',
    beverage: '飲料',
    ice_cream: '冰品',
    bar: '酒吧',
    food_court: '美食街',
    market: '市場',
    convenience: '便利商店',
    other: '其他',
};

function classifyPriceTier({ name, amenity, shop, cuisine }) {
    if (name && NAME_PRICEY.test(name)) return 'over_200';
    if (name && NAME_CHEAP.test(name)) return 'under_200';

    // cuisine 欄位可能是英文 tag、也可能被填中文，兩者都檢查
    const cuisineRaw = (cuisine || '').trim();
    if (cuisineRaw) {
        if (NAME_PRICEY.test(cuisineRaw)) return 'over_200';
        if (NAME_CHEAP.test(cuisineRaw)) return 'under_200';
        const cuisineList = cuisineRaw.toLowerCase().split(/[;,]/).map(s => s.trim()).filter(Boolean);
        if (cuisineList.some(c => CUISINE_PRICEY.has(c))) return 'over_200';
        if (cuisineList.some(c => CUISINE_CHEAP.has(c))) return 'under_200';
    }

    if (shop && SHOP_TIER[shop]) return SHOP_TIER[shop];
    if (amenity && AMENITY_TIER[amenity]) return AMENITY_TIER[amenity];

    return 'unknown';
}

// ============ 距離（haversine） ============
function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// ============ overrides ============
async function loadOverrides() {
    try {
        const raw = await readFile(join(ROOT, 'data/overrides.json'), 'utf8');
        const json = JSON.parse(raw);
        return json.by_id ?? {};
    } catch {
        return {};
    }
}

// ============ 主流程 ============
function normalize(elements) {
    const seen = new Set();
    const out = [];
    for (const el of elements) {
        const tags = el.tags || {};
        const name = tags.name || tags['name:zh'] || tags['name:zh-TW'] || tags['name:en'];
        if (!name) continue;

        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) continue;

        const id = `${el.type}/${el.id}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const schedule = parseOpeningHours(tags.opening_hours);
        let meal_times = deriveMealTimes(schedule);
        let meal_times_inferred = false;
        if (meal_times.length === 0) {
            meal_times = inferMealTimesFallback({
                name, amenity: tags.amenity, shop: tags.shop, cuisine: tags.cuisine,
            });
            meal_times_inferred = true;
        }
        const price_tier = classifyPriceTier({
            name, amenity: tags.amenity, shop: tags.shop, cuisine: tags.cuisine,
        });
        const category = classifyCategory({
            amenity: tags.amenity, shop: tags.shop, cuisine: tags.cuisine, name,
        });

        out.push({
            id,
            name,
            lat, lng,
            distance_m: distanceMeters(CENTER.lat, CENTER.lng, lat, lng),
            category,                         // restaurant|fast_food|cafe|bakery|beverage|ice_cream|bar|food_court|market|convenience|other
            category_label: CATEGORY_LABEL[category],
            amenity: tags.amenity ?? null,
            shop: tags.shop ?? null,
            cuisine: translateCuisine(tags.cuisine),
            cuisine_raw: tags.cuisine ?? null,
            price_tier,                       // 'under_200' | 'over_200' | 'unknown'
            meal_times,                       // ['breakfast','lunch','dinner']
            meal_times_inferred,              // true 表示無 opening_hours、是用啟發式推的
            schedule,                         // { mon:[[s,e]...], ... } 分鐘為單位
            opening_hours_raw: tags.opening_hours ?? null,
            takeaway: tags.takeaway === 'yes',
            delivery: tags.delivery === 'yes',
            outdoor_seating: tags.outdoor_seating === 'yes',
            wheelchair: tags.wheelchair ?? null,
            phone: tags.phone || tags['contact:phone'] || null,
            website: tags.website || tags['contact:website'] || null,
            address: composeAddress(tags),
        });
    }
    return out;
}

function composeAddress(tags) {
    const parts = [
        tags['addr:full'],
        [tags['addr:city'], tags['addr:district'], tags['addr:street'], tags['addr:housenumber']]
            .filter(Boolean).join(''),
    ].filter(Boolean);
    return parts[0] || null;
}

function applyOverrides(places, overrides) {
    let touched = 0;
    for (const p of places) {
        const o = overrides[p.id];
        if (!o) continue;
        Object.assign(p, o);
        p.override_applied = true;
        touched++;
    }
    return touched;
}

function summarize(places) {
    const tally = (key, val) => places.filter(p => p[key] === val).length;
    const mealTally = m => places.filter(p => p.meal_times.includes(m)).length;
    const byCategory = {};
    for (const p of places) byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    return {
        total: places.length,
        price: {
            under_200: tally('price_tier', 'under_200'),
            over_200: tally('price_tier', 'over_200'),
            unknown: tally('price_tier', 'unknown'),
        },
        meals: {
            breakfast: mealTally('breakfast'),
            lunch: mealTally('lunch'),
            dinner: mealTally('dinner'),
        },
        category: byCategory,
    };
}

async function main() {
    console.log(`[fetch-places] 中心點：${CENTER.label}`);
    console.log(`[fetch-places] 範圍：${RADIUS_M} m`);
    console.log('[fetch-places] 查詢 Overpass…');

    const elements = await fetchOverpass();
    console.log(`[fetch-places] Overpass 回 ${elements.length} 筆原始元素`);

    const overrides = await loadOverrides();
    let places = normalize(elements);
    const touched = applyOverrides(places, overrides);
    places.sort((a, b) => a.distance_m - b.distance_m);

    const output = {
        generated_at: new Date().toISOString(),
        center: CENTER,
        radius_m: RADIUS_M,
        source: 'OpenStreetMap via Overpass API',
        license: 'ODbL (© OpenStreetMap contributors)',
        overrides_applied: touched,
        count: places.length,
        places,
    };

    const outPath = join(ROOT, 'data/places.json');
    await writeFile(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.log(`[fetch-places] 寫入 ${outPath}`);
    console.log('[fetch-places] 統計：', summarize(places));
    if (touched) console.log(`[fetch-places] 套用 overrides：${touched} 筆`);
}

main().catch(err => {
    console.error('[fetch-places] 失敗：', err);
    process.exit(1);
});
