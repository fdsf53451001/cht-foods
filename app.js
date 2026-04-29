// 中華電信總公司附近美食地圖
// 資料：data/places.json（由 scripts/fetch-places.js 從 OSM Overpass 抓取）

const DATA_URL = 'data/places.json';

// State
const DEFAULT_CATEGORIES = new Set([
    'restaurant', 'fast_food', 'cafe', 'bakery', 'beverage',
    'ice_cream', 'bar', 'food_court',
]);
const state = {
    data: null,
    filtered: [],
    meal: 'now',                                 // 'now' | 'breakfast' | 'lunch' | 'dinner' | 'any'
    price: 'any',                                // 'any' | 'under_200' | 'other'
    categories: new Set(DEFAULT_CATEGORIES),     // multi-select
    openNow: false,
    keyword: '',
    sort: 'distance',                            // 'distance' | 'name'
};

let map = null;
let markerLayer = null;
let centerMarker = null;
const placeMarkers = new Map(); // id -> L.marker

// DOM
const $ = sel => document.querySelector(sel);
const placesList = $('#placesList');
const placesCount = $('#placesCount');
const searchInput = $('#searchInput');
const clearSearchBtn = $('#clearSearchBtn');
const openNowCheckbox = $('#openNowCheckbox');
const recenterBtn = $('#recenterBtn');
const randomBtn = $('#randomBtn');

// ============ 啟動 ============
init().catch(err => {
    console.error(err);
    placesList.innerHTML = `<div class="loading-state"><span class="material-icons-round" style="font-size:48px;color:#e74c3c;">error_outline</span><p>載入店家資料失敗：${err.message}</p></div>`;
});

async function init() {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();

    initMap();
    bindEvents();
    applyFilters();
}

// ============ 地圖 ============
function initMap() {
    const { lat, lng, label } = state.data.center;

    map = L.map('map', {
        center: [lat, lng],
        zoom: 17,
        zoomControl: false,
    });
    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // 中心點標示
    centerMarker = L.circleMarker([lat, lng], {
        radius: 9,
        color: '#fff',
        weight: 2,
        fillColor: '#4285F4',
        fillOpacity: 1,
    }).addTo(map).bindTooltip(label, { permanent: false, direction: 'top', offset: [0, -8] });

    // 800m 範圍圓圈
    L.circle([lat, lng], {
        radius: state.data.radius_m,
        color: '#4285F4',
        weight: 1,
        fillOpacity: 0.04,
        dashArray: '4 4',
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
}

// ============ Filter / Sort ============
function applyFilters() {
    const places = state.data.places;
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
    const currentMeal = mealOfDay(minutesNow); // 'breakfast'|'lunch'|'dinner'|null
    const kw = state.keyword.trim().toLowerCase();

    state.filtered = places.filter(p => {
        // 類別
        if (!state.categories.has(p.category)) return false;

        // 關鍵字
        if (kw) {
            const hay = `${p.name} ${(p.cuisine || []).join(' ')} ${p.cuisine_raw || ''} ${p.address || ''}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }

        // 時段
        if (state.meal === 'now') {
            if (currentMeal && !p.meal_times.includes(currentMeal)) return false;
        } else if (state.meal !== 'any') {
            if (!p.meal_times.includes(state.meal)) return false;
        }

        // 價位
        if (state.price === 'under_200') {
            if (p.price_tier !== 'under_200') return false;
        } else if (state.price === 'other') {
            if (p.price_tier === 'under_200') return false;
        }

        // 現在營業
        if (state.openNow) {
            if (!isOpenAt(p, dayKey, minutesNow)) return false;
        }

        return true;
    });

    sortFiltered();
    render();
}

function sortFiltered() {
    if (state.sort === 'name') {
        state.filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    } else {
        state.filtered.sort((a, b) => a.distance_m - b.distance_m);
    }
}

// 把當下時間歸到最相關的一餐。覆蓋整天，下午茶時段歸到 dinner（最接近的下一餐）。
// 凌晨 22:00–05:00 不歸任何 meal（深夜大多數店家都休息），「現在」chip 此時等同「全部」。
function mealOfDay(min) {
    if (min >= 5 * 60 && min < 10 * 60 + 30) return 'breakfast';   // 05:00–10:30
    if (min >= 10 * 60 + 30 && min < 15 * 60) return 'lunch';      // 10:30–15:00
    if (min >= 15 * 60 && min < 22 * 60) return 'dinner';          // 15:00–22:00
    return null;                                                    // 22:00–05:00
}

function isOpenAt(place, dayKey, minutesNow) {
    if (!place.schedule) return false; // 沒資料 → 不能保證營業中
    const ranges = place.schedule[dayKey] || [];
    return ranges.some(([s, e]) => {
        if (e <= 1440) return minutesNow >= s && minutesNow < e;
        // 跨夜
        return minutesNow >= s || minutesNow < (e - 1440);
    });
}

// ============ 渲染 ============
function render() {
    placesCount.textContent = `${state.filtered.length} 個結果`;
    renderList();
    renderMarkers();
}

function renderList() {
    placesList.innerHTML = '';
    if (state.filtered.length === 0) {
        placesList.innerHTML = `<div class="loading-state"><span class="material-icons-round" style="font-size:48px;color:#ddd;">search_off</span><p>沒有符合的店家</p></div>`;
        return;
    }

    const frag = document.createDocumentFragment();
    for (const p of state.filtered) {
        frag.appendChild(buildPlaceCard(p));
    }
    placesList.appendChild(frag);
}

function buildPlaceCard(p) {
    const item = document.createElement('div');
    item.className = 'place-item';
    item.dataset.id = p.id;

    const priceBadge = priceBadgeHTML(p.price_tier);
    const mealBadges = (p.meal_times || []).map(m => `<span class="meal-tag meal-${m}">${mealLabel(m)}</span>`).join('');
    const cuisineTags = (p.cuisine || []).slice(0, 3).map(c => `<span class="type-tag">${c}</span>`).join('');
    const distance = p.distance_m < 1000 ? `${p.distance_m}m` : `${(p.distance_m / 1000).toFixed(1)}km`;
    const inferred = p.meal_times_inferred ? '<span class="inferred-mark" title="無營業時間資訊，依店家類型推估">推估</span>' : '';

    const categoryTag = p.category_label
        ? `<span class="category-tag cat-${p.category}">${p.category_label}</span>`
        : '';

    item.innerHTML = `
        <div class="place-info">
            <div class="place-name-row">
                <div class="place-name">${escapeHTML(p.name)}</div>
                ${priceBadge}
            </div>
            <div class="place-meta">
                ${categoryTag}
                <span class="distance-badge">📍 ${distance}</span>
                ${mealBadges}
                ${inferred}
            </div>
            <div class="place-tags">${cuisineTags}</div>
            ${p.address ? `<div class="place-address">${escapeHTML(p.address)}</div>` : ''}
        </div>
        <button class="nav-btn" title="在 Google Maps 開啟">
            <span class="material-icons-round">open_in_new</span>
        </button>
    `;

    item.querySelector('.nav-btn').addEventListener('click', e => {
        e.stopPropagation();
        const q = encodeURIComponent(`${p.name} ${p.address || ''}`.trim());
        window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
    });

    item.addEventListener('click', () => focusPlace(p));
    return item;
}

function priceBadgeHTML(tier) {
    if (tier === 'under_200') return `<span class="price-badge price-cheap">≤ 200</span>`;
    if (tier === 'over_200') return `<span class="price-badge price-expensive">&gt; 200</span>`;
    return `<span class="price-badge price-unknown">未知</span>`;
}

function mealLabel(m) {
    return { breakfast: '早', lunch: '午', dinner: '晚' }[m] || m;
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderMarkers() {
    markerLayer.clearLayers();
    placeMarkers.clear();

    const visible = new Set(state.filtered.map(p => p.id));
    for (const p of state.filtered) {
        const marker = L.marker([p.lat, p.lng], {
            icon: pinIcon(p.price_tier),
            title: p.name,
        });
        marker.bindPopup(buildPopup(p));
        marker.on('click', () => highlightCard(p.id));
        marker.addTo(markerLayer);
        placeMarkers.set(p.id, marker);
    }
}

function pinIcon(tier) {
    const color = tier === 'under_200' ? '#27ae60' : tier === 'over_200' ? '#e67e22' : '#7f8c8d';
    return L.divIcon({
        className: 'food-pin',
        html: `<div class="pin-dot" style="background:${color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
    });
}

function buildPopup(p) {
    const distance = p.distance_m < 1000 ? `${p.distance_m}m` : `${(p.distance_m / 1000).toFixed(1)}km`;
    const meals = (p.meal_times || []).map(mealLabel).join('／') || '時段未知';
    const price = p.price_tier === 'under_200' ? '≤ 200' : p.price_tier === 'over_200' ? '> 200' : '價位未知';
    const cuisine = (p.cuisine || []).join('、') || '';
    const q = encodeURIComponent(`${p.name} ${p.address || ''}`.trim());
    return `
        <div class="popup-card">
            <strong>${escapeHTML(p.name)}</strong><br>
            <small>${cuisine}</small><br>
            <small>📍 ${distance} ・ ${price} ・ ${meals}</small><br>
            <a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">在 Google Maps 開啟</a>
        </div>
    `;
}

function focusPlace(p) {
    map.flyTo([p.lat, p.lng], 18, { duration: 0.5 });
    const m = placeMarkers.get(p.id);
    if (m) m.openPopup();
    if (window.innerWidth < 768) minimizePanel();
}

function highlightCard(id) {
    const el = placesList.querySelector(`.place-item[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 1500);
}

// ============ 事件 ============
function bindEvents() {
    // chip groups
    document.querySelectorAll('#mealChips .chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#mealChips .chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.meal = btn.dataset.meal;
            applyFilters();
        });
    });
    document.querySelectorAll('#priceChips .chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#priceChips .chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.price = btn.dataset.price;
            applyFilters();
        });
    });

    // category（多選 toggle）
    document.querySelectorAll('#categoryChips .chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.category;
            if (state.categories.has(cat)) {
                state.categories.delete(cat);
                btn.classList.remove('active');
            } else {
                state.categories.add(cat);
                btn.classList.add('active');
            }
            applyFilters();
        });
    });

    openNowCheckbox.addEventListener('change', () => {
        state.openNow = openNowCheckbox.checked;
        applyFilters();
    });

    // sort
    document.querySelectorAll('.sort-btn[data-sort]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn[data-sort]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.sort = btn.dataset.sort;
            sortFiltered();
            renderList();
        });
    });

    // search
    searchInput.addEventListener('input', () => {
        state.keyword = searchInput.value;
        applyFilters();
    });
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        state.keyword = '';
        applyFilters();
    });

    // recenter
    recenterBtn.addEventListener('click', () => {
        const { lat, lng } = state.data.center;
        map.flyTo([lat, lng], 17, { duration: 0.5 });
    });

    // random
    randomBtn.addEventListener('click', showRandomPick);

    // mobile bottom sheet
    initBottomSheet();
}

// ============ 隨機 ============
function showRandomPick() {
    if (state.filtered.length === 0) {
        alert('目前沒有符合條件的店家，先放寬篩選再抽 ：）');
        return;
    }
    const pick = state.filtered[Math.floor(Math.random() * state.filtered.length)];

    document.getElementById('randomResultModal')?.remove();

    const distance = pick.distance_m < 1000 ? `${pick.distance_m}m` : `${(pick.distance_m / 1000).toFixed(1)}km`;
    const price = priceBadgeHTML(pick.price_tier);
    const meals = (pick.meal_times || []).map(mealLabel).join('／') || '時段未知';
    const cuisine = (pick.cuisine || []).join('、') || '';

    const modal = document.createElement('div');
    modal.id = 'randomResultModal';
    modal.className = 'random-modal';
    modal.innerHTML = `
        <div class="random-modal-content">
            <div class="random-modal-header">
                <span class="material-icons-round random-dice">casino</span>
                <h2>今天就吃這個！</h2>
            </div>
            <div class="random-place-card">
                <div class="random-place-info">
                    <h3>${escapeHTML(pick.name)}</h3>
                    <div class="random-place-meta">
                        ${price}
                        <span>📍 ${distance}</span>
                        <span>${meals}</span>
                    </div>
                    ${cuisine ? `<p class="random-place-address">${cuisine}</p>` : ''}
                    ${pick.address ? `<p class="random-place-address">${escapeHTML(pick.address)}</p>` : ''}
                </div>
            </div>
            <div class="random-modal-actions">
                <button class="random-btn-secondary" id="randomAgainBtn">
                    <span class="material-icons-round">refresh</span>再抽一次
                </button>
                <button class="random-btn-primary" id="randomGoBtn">
                    <span class="material-icons-round">place</span>就決定是你了
                </button>
            </div>
            <button class="random-close-btn" id="randomCloseBtn">
                <span class="material-icons-round">close</span>
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('randomCloseBtn').addEventListener('click', () => modal.remove());
    document.getElementById('randomAgainBtn').addEventListener('click', () => { modal.remove(); showRandomPick(); });
    document.getElementById('randomGoBtn').addEventListener('click', () => {
        modal.remove();
        focusPlace(pick);
        highlightCard(pick.id);
    });
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ============ Mobile bottom sheet ============
const PANEL_MIN_HEIGHT = 15;
const PANEL_DEFAULT_HEIGHT = 50;
const PANEL_MAX_HEIGHT = 70;

let placesPanel, panelHandle, collapseBtn;
let isDragging = false, startY = 0, startHeight = 0, isPanelMinimized = false;

function initBottomSheet() {
    placesPanel = document.querySelector('.places-panel');
    panelHandle = document.querySelector('.panel-handle');
    collapseBtn = document.getElementById('collapseBtn');

    collapseBtn.addEventListener('click', () => {
        isPanelMinimized ? resetPanel() : minimizePanel();
    });

    panelHandle.addEventListener('touchstart', e => {
        if (window.innerWidth >= 768) return;
        isDragging = true;
        startY = e.touches[0].clientY;
        startHeight = placesPanel.getBoundingClientRect().height;
        placesPanel.style.transition = 'none';
        recenterBtn.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const deltaY = startY - e.touches[0].clientY;
        const newHeight = startHeight + deltaY;
        const heightVh = (newHeight / window.innerHeight) * 100;
        const clamped = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, heightVh));
        placesPanel.style.height = clamped + 'vh';
        updateFabPosition(clamped);
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        placesPanel.style.transition = 'height 0.3s ease';
        recenterBtn.style.transition = 'bottom 0.3s ease';

        const cur = (placesPanel.getBoundingClientRect().height / window.innerHeight) * 100;
        if (cur < 25) minimizePanel();
        else if (cur > 60) maximizePanel();
        else resetPanel();
    });

    let lastTap = 0;
    panelHandle.addEventListener('touchend', e => {
        const now = Date.now();
        if (now - lastTap < 300 && now - lastTap > 0) {
            e.preventDefault();
            isPanelMinimized ? resetPanel() : minimizePanel();
        }
        lastTap = now;
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            placesPanel.style.height = '';
            recenterBtn.style.bottom = '';
        } else {
            resetPanel();
        }
    });

    if (window.innerWidth < 768) resetPanel();
}

function minimizePanel() {
    placesPanel.style.height = PANEL_MIN_HEIGHT + 'vh';
    placesPanel.classList.add('minimized');
    isPanelMinimized = true;
    updateFabPosition(PANEL_MIN_HEIGHT);
}
function resetPanel() {
    placesPanel.style.height = PANEL_DEFAULT_HEIGHT + 'vh';
    placesPanel.classList.remove('minimized');
    isPanelMinimized = false;
    updateFabPosition(PANEL_DEFAULT_HEIGHT);
}
function maximizePanel() {
    placesPanel.style.height = PANEL_MAX_HEIGHT + 'vh';
    placesPanel.classList.remove('minimized');
    isPanelMinimized = false;
    updateFabPosition(PANEL_MAX_HEIGHT);
}
function updateFabPosition(panelHeightVh) {
    if (window.innerWidth < 768) {
        recenterBtn.style.bottom = `calc(${panelHeightVh}vh + 20px)`;
    }
}
