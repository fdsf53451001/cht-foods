let map;
let service;
let infowindow;
let markers = [];
let userLocation = null;
let currentCategory = '';
let paginationObj = null; // Store pagination object
let customKeyword = ''; // 使用者輸入的關鍵字

// DOM Elements
const apiKeyModal = document.getElementById('apiKeyModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const submitApiKeyBtn = document.getElementById('submitApiKey');
const placesList = document.getElementById('placesList');
const placesCount = document.getElementById('placesCount');
const myLocationBtn = document.getElementById('myLocationBtn');
const categoryChips = document.querySelectorAll('.category-chip');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const randomBtn = document.getElementById('randomBtn');

// 排序相關
const sortBtns = document.querySelectorAll('.sort-btn');
let currentSort = 'default';
let allPlaces = []; // 儲存所有搜尋結果用於排序

// 搜尋按鈕點擊
searchBtn.addEventListener('click', () => {
    customKeyword = searchInput.value.trim();
    searchNearby();
});

// Enter 鍵搜尋
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        customKeyword = searchInput.value.trim();
        searchNearby();
    }
});

// 排序按鈕點擊事件
sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        sortBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSort = btn.dataset.sort;
        sortAndRenderPlaces();
    });
});

// 隨機按鈕點擊事件
randomBtn.addEventListener('click', () => {
    if (!allPlaces || allPlaces.length === 0) {
        alert('目前沒有搜尋結果，請先搜尋附近美食！');
        return;
    }
    
    // 隨機選取一個地點
    const randomIndex = Math.floor(Math.random() * allPlaces.length);
    const randomPlace = allPlaces[randomIndex];
    
    // 顯示隨機結果彈窗
    showRandomResult(randomPlace);
});

// 顯示隨機結果
function showRandomResult(place) {
    // 移除舊的彈窗（如果有）
    const oldModal = document.getElementById('randomResultModal');
    if (oldModal) oldModal.remove();
    
    // 建立彈窗
    const modal = document.createElement('div');
    modal.id = 'randomResultModal';
    modal.className = 'random-modal';
    
    const priceText = place.price_level ? '$'.repeat(place.price_level) : '價格未知';
    const ratingText = place.rating ? `⭐ ${place.rating}` : '無評分';
    const distanceText = place.distance ? `${Math.round(place.distance)}m` : '';
    const photoUrl = place.photos && place.photos[0] 
        ? place.photos[0].getUrl({ maxWidth: 400, maxHeight: 300 })
        : 'https://via.placeholder.com/400x200?text=No+Image';
    
    modal.innerHTML = `
        <div class="random-modal-content">
            <div class="random-modal-header">
                <span class="material-icons-round random-dice">casino</span>
                <h2>今天就吃這個！</h2>
            </div>
            <div class="random-place-card">
                <img src="${photoUrl}" alt="${place.name}" class="random-place-image">
                <div class="random-place-info">
                    <h3>${place.name}</h3>
                    <div class="random-place-meta">
                        <span>${ratingText}</span>
                        <span>${priceText}</span>
                        ${distanceText ? `<span>📍 ${distanceText}</span>` : ''}
                    </div>
                    <p class="random-place-address">${place.vicinity || ''}</p>
                </div>
            </div>
            <div class="random-modal-actions">
                <button class="random-btn-secondary" id="randomAgainBtn">
                    <span class="material-icons-round">refresh</span>再抽一次
                </button>
                <button class="random-btn-primary" id="randomGoBtn">
                    <span class="material-icons-round">directions</span>就決定是你了
                </button>
            </div>
            <button class="random-close-btn" id="randomCloseBtn">
                <span class="material-icons-round">close</span>
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 綁定事件
    document.getElementById('randomCloseBtn').addEventListener('click', () => modal.remove());
    document.getElementById('randomAgainBtn').addEventListener('click', () => {
        modal.remove();
        randomBtn.click();
    });
    document.getElementById('randomGoBtn').addEventListener('click', () => {
        modal.remove();
        // 移動地圖到該地點
        map.panTo(place.geometry.location);
        map.setZoom(17);
        // 找到對應的 marker 並觸發點擊
        const marker = markers.find(m => m.getTitle() === place.name);
        if (marker) {
            google.maps.event.trigger(marker, 'click');
        }
        // 捲動列表到該項目
        const placeItem = document.querySelector(`.place-item[data-place-id="${place.place_id}"]`);
        if (placeItem) {
            placeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            placeItem.classList.add('highlight');
            setTimeout(() => placeItem.classList.remove('highlight'), 2000);
        }
    });
    
    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function sortAndRenderPlaces() {
    if (!allPlaces || allPlaces.length === 0) return;
    
    let sortedPlaces = [...allPlaces];
    
    switch (currentSort) {
        case 'price':
            // 價格由低到高，未知價格排最後
            sortedPlaces.sort((a, b) => {
                const priceA = a.price_level ?? 99;
                const priceB = b.price_level ?? 99;
                return priceA - priceB;
            });
            break;
        case 'distance':
            // 距離由近到遠
            sortedPlaces.sort((a, b) => {
                const distA = a.distance ?? 99999;
                const distB = b.distance ?? 99999;
                return distA - distB;
            });
            break;
        case 'rating':
            // 評分由高到低
            sortedPlaces.sort((a, b) => {
                const ratingA = a.rating ?? 0;
                const ratingB = b.rating ?? 0;
                return ratingB - ratingA;
            });
            break;
        default:
            // 預設順序（API 回傳順序）
            break;
    }
    
    // 清除列表並重新渲染
    placesList.innerHTML = '';
    clearMarkers();
    renderList(sortedPlaces);
    renderMarkers(sortedPlaces);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check if API key is already in session storage (optional, for reload convenience)
    const storedKey = sessionStorage.getItem('googleMapsApiKey');
    if (storedKey) {
        loadGoogleMaps(storedKey);
    }
});

submitApiKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        sessionStorage.setItem('googleMapsApiKey', key);
        loadGoogleMaps(key);
    } else {
        alert('請輸入有效的 API Key');
    }
});

function loadGoogleMaps(key) {
    const script = document.createElement('script');
    // 加入 geometry library 用於計算距離
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry&language=zh-TW&callback=initMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        alert('Google Maps API 載入失敗，請檢查 Key 是否正確');
        apiKeyModal.style.display = 'flex';
        sessionStorage.removeItem('googleMapsApiKey');
    };
    document.head.appendChild(script);
    apiKeyModal.style.display = 'none';
}

window.initMap = function () {
    // Default to Taipei 101 if geolocation fails
    const defaultLocation = { lat: 25.033964, lng: 121.564468 };

    map = new google.maps.Map(document.getElementById('map'), {
        center: defaultLocation,
        zoom: 15,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        zoomControl: false, // Clean look
        styles: [
            {
                featureType: "poi",
                elementType: "labels",
                stylers: [{ visibility: "off" }] // Hide default POIs to reduce clutter
            }
        ]
    });

    infowindow = new google.maps.InfoWindow();
    service = new google.maps.places.PlacesService(map);

    // Try to get user location
    getUserLocation();
};

function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                map.setCenter(userLocation);

                // Add blue dot for user location
                new google.maps.Marker({
                    position: userLocation,
                    map: map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 10,
                        fillColor: "#4285F4",
                        fillOpacity: 1,
                        strokeColor: "white",
                        strokeWeight: 2,
                    },
                    title: "您的位置"
                });

                // Initial search
                searchNearby();
                searchAreaBtn.style.display = 'none'; // Hide button after initial search
            },
            () => {
                handleLocationError(true);
                // Initial search even if location fails (uses default)
                searchNearby();
            }
        );
    } else {
        handleLocationError(false);
        searchNearby();
    }
}

function handleLocationError(browserHasGeolocation) {
    console.log(browserHasGeolocation ?
        'Error: The Geolocation service failed.' :
        'Error: Your browser doesn\'t support geolocation.');
    // Keep default center
}

myLocationBtn.addEventListener('click', () => {
    if (userLocation) {
        map.panTo(userLocation);
        map.setZoom(16);
    } else {
        getUserLocation();
    }
});

// Category Filtering
categoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
        // Update UI
        categoryChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        // Update Logic
        currentCategory = chip.dataset.type;
        customKeyword = ''; // 清除自訂關鍵字
        searchInput.value = ''; // 清除輸入框
        searchNearby();
    });
});

// 儲存使用者位置用於計算距離
let searchCenter = null;

function searchNearby() {
    if (!map || !service) return;

    const center = map.getCenter();
    searchCenter = center; // 儲存搜尋中心點
    
    const request = {
        location: center,
        radius: 1200, // 1.2km radius
        includedTypes: 'food', // Default type
    };

    // 如果有自訂關鍵字，優先使用
    if (customKeyword) {
        request.keyword = customKeyword;
    } else if (currentCategory === '') {
        request.keyword = 'food';
    } else if (currentCategory === 'breakfast') {
        request.keyword = '早餐|早午餐|brunch';
    } else if (currentCategory === 'lunch_cheap') {
        // 不設 maxPrice，改用 client-side 排序
        request.keyword = '小吃|便當|麵|飯|滷肉飯|自助餐|快餐';
    } else if (currentCategory === 'lunch_expensive') {
        request.keyword = '餐廳|料理|牛排|日式|義式';
        request.minPrice = 2; // Expensive ($$+)
    } else if (currentCategory === 'drinks') {
        request.keyword = '手搖飲|果汁';
        // delete request.type; // Remove 'restaurant' type restriction for drinks
    } 
    // else {
    //     request.type = currentCategory; // For 'restaurant'
    // }

    // Reset UI for new search
    placesList.innerHTML = '<div class="loading-state"><span class="material-icons-round spin">sync</span><p>搜尋中...</p></div>';
    clearMarkers();
    markers = [];
    isFetchingNextPage = false; // Reset flag for new search

    service.nearbySearch(request, (results, status, pagination) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            // Client-side filtering
            if (request.minPrice !== undefined) {
                results = results.filter(p => !p.price_level || p.price_level >= request.minPrice);
            }
            
            // 計算每個店家的距離
            results.forEach(place => {
                if (searchCenter && place.geometry && place.geometry.location) {
                    place.distance = google.maps.geometry.spherical.computeDistanceBetween(
                        searchCenter,
                        place.geometry.location
                    );
                }
            });
            
            // 儲存結果供排序使用
            if (!isFetchingNextPage) {
                allPlaces = results;
            } else {
                allPlaces = [...allPlaces, ...results];
            }
        }
        handleSearchResults(results, status, pagination);
    });
}

function handleSearchResults(results, status, pagination) {
    if (status === google.maps.places.PlacesServiceStatus.OK) {
        if (!isFetchingNextPage) {
            // New Search: Clear everything and reset sort
            placesList.innerHTML = '';
            placesCount.innerText = `${results.length} 個結果`;
            // 重置排序為預設
            sortBtns.forEach(b => b.classList.remove('active'));
            document.querySelector('.sort-btn[data-sort="default"]').classList.add('active');
            currentSort = 'default';
        } else {
            // Load More: Just append, don't clear
            // Update count - 使用 allPlaces 來獲取正確的總數
            placesCount.innerText = `${allPlaces.length} 個結果`;
        }

        renderList(results);
        renderMarkers(results);

        // Handle Pagination
        if (pagination && pagination.hasNextPage) {
            renderLoadMoreButton(pagination);
        } else {
            removeLoadMoreButton();
            // 更新最終結果數
            placesCount.innerText = `${allPlaces.length} 個結果`;
        }

    } else {
        console.error('Search failed:', status);
        let errorMessage = '附近沒有找到相關結果';
        if (status === 'REQUEST_DENIED') errorMessage = 'API Key 權限不足 (請啟用 Places API)';
        if (status === 'OVER_QUERY_LIMIT') errorMessage = 'API 配額已滿或未啟用計費';
        if (status === 'ZERO_RESULTS') errorMessage = '此區域附近沒有找到結果';

        if (!isFetchingNextPage) {
            placesList.innerHTML = `
                <div class="loading-state">
                    <span class="material-icons-round" style="font-size: 48px; color: #ddd;">error_outline</span>
                    <p>${errorMessage}</p>
                </div>
            `;
            placesCount.innerText = '0 個結果';
        } else {
            // If failed during load more, maybe alert or show toast
            alert('無法載入更多結果: ' + errorMessage);
        }
    }
}

function renderLoadMoreButton(pagination) {
    removeLoadMoreButton(); // Avoid duplicates

    // 自動載入下一頁（最多載入 3 頁，約 60 個結果）
    const currentCount = document.querySelectorAll('.place-item').length;
    if (currentCount < 60) {
        // 自動載入下一頁
        setTimeout(() => {
            isFetchingNextPage = true;
            pagination.nextPage();
        }, 500); // 稍微延遲避免 API 過於頻繁
        return;
    }

    // 如果已經載入夠多，顯示手動載入按鈕
    const btnContainer = document.createElement('div');
    btnContainer.id = 'loadMoreContainer';
    btnContainer.style.textAlign = 'center';
    btnContainer.style.padding = '20px';

    const btn = document.createElement('button');
    btn.innerText = '載入更多';
    btn.className = 'category-chip'; // Reuse style
    btn.style.background = '#f1f3f4';
    btn.onclick = () => {
        btn.innerText = '載入中...';
        btn.disabled = true;
        isFetchingNextPage = true; // Set flag
        pagination.nextPage(); // Triggers handleSearchResults again
    };

    btnContainer.appendChild(btn);
    placesList.appendChild(btnContainer);
}

function removeLoadMoreButton() {
    const existing = document.getElementById('loadMoreContainer');
    if (existing) existing.remove();
}

function clearMarkers() {
    markers.forEach(m => m.setMap(null));
    markers = [];
}

function renderMarkers(places) {
    places.forEach(place => {
        const marker = new google.maps.Marker({
            map: map,
            position: place.geometry.location,
            title: place.name,
            animation: google.maps.Animation.DROP
        });

        marker.addListener('click', () => {
            let priceDisplay = '';
            if (place.price_level === 0) priceDisplay = '免費';
            else if (place.price_level) priceDisplay = '$'.repeat(place.price_level);
            else priceDisplay = '價格未知';

            const content = `
                <div style="padding: 8px;">
                    <strong>${place.name}</strong><br>
                    <span style="color: #666;">${place.rating || '無'} ⭐</span><br>
                    <span style="color: #666;">${priceDisplay}</span><br>
                    <small>${place.vicinity}</small>
                </div>
            `;
            infowindow.setContent(content);
            infowindow.open(map, marker);
        });

        markers.push(marker);
    });
}

function renderList(places) {
    places.forEach(place => {
        const photoUrl = place.photos && place.photos.length > 0
            ? place.photos[0].getUrl({ maxWidth: 200, maxHeight: 200 })
            : 'https://via.placeholder.com/80?text=No+Img';

        // 價格顯示
        let priceDisplay = '';
        let priceClass = '';
        if (place.price_level === 0) {
            priceDisplay = '免費';
            priceClass = 'price-free';
        } else if (place.price_level === 1) {
            priceDisplay = '$';
            priceClass = 'price-cheap';
        } else if (place.price_level === 2) {
            priceDisplay = '$$';
            priceClass = 'price-moderate';
        } else if (place.price_level >= 3) {
            priceDisplay = '$'.repeat(place.price_level);
            priceClass = 'price-expensive';
        } else {
            priceDisplay = '價位未知';
            priceClass = 'price-unknown';
        }

        // 營業狀態 - nearbySearch 只返回 open_now 布林值
        let statusDisplay = '';
        let statusClass = '';
        if (place.opening_hours && place.opening_hours.open_now !== undefined) {
            if (place.opening_hours.open_now === true) {
                statusDisplay = '營業中';
                statusClass = 'status-open';
            } else {
                statusDisplay = '休息中';
                statusClass = 'status-closed';
            }
        }

        // 距離顯示
        let distanceDisplay = '';
        if (place.distance) {
            if (place.distance < 1000) {
                distanceDisplay = Math.round(place.distance) + 'm';
            } else {
                distanceDisplay = (place.distance / 1000).toFixed(1) + 'km';
            }
        }

        // 店家類型標籤
        let typeTags = '';
        if (place.types && place.types.length > 0) {
            const typeMap = {
                'restaurant': '餐廳',
                'cafe': '咖啡廳',
                'bakery': '烘焙',
                'bar': '酒吧',
                'meal_delivery': '外送',
                'meal_takeaway': '外帶',
                'food': '美食'
            };
            const displayTypes = place.types
                .filter(t => typeMap[t])
                .map(t => typeMap[t])
                .slice(0, 2);
            if (displayTypes.length > 0) {
                typeTags = displayTypes.map(t => `<span class="type-tag">${t}</span>`).join('');
            }
        }

        const item = document.createElement('div');
        item.className = 'place-item';
        item.dataset.placeId = place.place_id;
        item.innerHTML = `
            <img src="${photoUrl}" alt="${place.name}" class="place-image">
            <div class="place-info">
                <div class="place-name-row">
                    <div class="place-name">${place.name}</div>
                    ${statusDisplay ? `<span class="status-badge ${statusClass}">${statusDisplay}</span>` : ''}
                </div>
                <div class="place-meta">
                    <span class="rating-star">★</span>
                    <span>${place.rating || 'N/A'}</span>
                    <span class="rating-count">(${place.user_ratings_total || 0})</span>
                    <span class="price-badge ${priceClass}">${priceDisplay}</span>
                    ${distanceDisplay ? `<span class="distance-badge">📍 ${distanceDisplay}</span>` : ''}
                </div>
                <div class="place-tags">${typeTags}</div>
                <div class="place-address">${place.vicinity}</div>
            </div>
            <button class="nav-btn" data-place-id="${place.place_id}" title="在 Google Maps 中查看">
                <span class="material-icons-round">open_in_new</span>
            </button>
        `;
        
        // 導航按鈕點擊事件
        const navBtn = item.querySelector('.nav-btn');
        navBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止觸發卡片點擊
            // 使用店家名稱和地址來開啟 Google Maps，這樣手機和電腦都能正常運作
            const query = encodeURIComponent(`${place.name} ${place.vicinity}`);
            const url = `https://www.google.com/maps/search/?api=1&query=${query}`;
            window.open(url, '_blank');
        });

        item.addEventListener('click', () => {
            map.panTo(place.geometry.location);
            map.setZoom(17);
            // Trigger marker click
            const marker = markers.find(m => m.getTitle() === place.name);
            if (marker) {
                google.maps.event.trigger(marker, 'click');
            }

            // On mobile, minimize the panel when selecting a place
            if (window.innerWidth < 768) {
                minimizePanel();
            }
        });

        placesList.appendChild(item);
    });
}

// ==================== Mobile Bottom Sheet Drag Functionality ====================
const placesPanel = document.querySelector('.places-panel');
const panelHandle = document.querySelector('.panel-handle');
const collapseBtn = document.getElementById('collapseBtn');
let isDragging = false;
let startY = 0;
let startHeight = 0;
let isPanelMinimized = false;

// Panel height states
const PANEL_MIN_HEIGHT = 15; // vh
const PANEL_DEFAULT_HEIGHT = 50; // vh
const PANEL_MAX_HEIGHT = 70; // vh - 不超過 header

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

// 收起按鈕點擊事件
collapseBtn.addEventListener('click', () => {
    if (isPanelMinimized) {
        resetPanel();
    } else {
        minimizePanel();
    }
});

function updateFabPosition(panelHeightVh) {
    if (window.innerWidth < 768) {
        myLocationBtn.style.bottom = `calc(${panelHeightVh}vh + 20px)`;
    }
}

// Touch events for mobile
panelHandle.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768) return;
    isDragging = true;
    startY = e.touches[0].clientY;
    startHeight = placesPanel.getBoundingClientRect().height;
    placesPanel.style.transition = 'none';
    myLocationBtn.style.transition = 'none';
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    
    const currentY = e.touches[0].clientY;
    const deltaY = startY - currentY;
    const newHeight = startHeight + deltaY;
    const windowHeight = window.innerHeight;
    const heightVh = (newHeight / windowHeight) * 100;
    
    // Clamp the height
    const clampedHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, heightVh));
    placesPanel.style.height = clampedHeight + 'vh';
    updateFabPosition(clampedHeight);
}, { passive: true });

document.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    
    placesPanel.style.transition = 'height 0.3s ease';
    myLocationBtn.style.transition = 'bottom 0.3s ease';
    
    // Snap to nearest state
    const currentHeight = (placesPanel.getBoundingClientRect().height / window.innerHeight) * 100;
    
    if (currentHeight < 25) {
        minimizePanel();
    } else if (currentHeight > 60) {
        maximizePanel();
    } else {
        resetPanel();
    }
});

// Double tap on handle to toggle between states
let lastTap = 0;
panelHandle.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    
    if (tapLength < 300 && tapLength > 0) {
        e.preventDefault();
        if (isPanelMinimized) {
            resetPanel();
        } else {
            minimizePanel();
        }
    }
    lastTap = currentTime;
});

// Handle window resize
window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
        // Reset to desktop styles
        placesPanel.style.height = '';
        myLocationBtn.style.bottom = '';
    } else {
        // Reset to mobile default
        resetPanel();
    }
});

// Initialize panel state on load
document.addEventListener('DOMContentLoaded', () => {
    if (window.innerWidth < 768) {
        resetPanel();
    }
});

