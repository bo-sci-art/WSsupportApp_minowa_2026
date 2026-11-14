/**
 * S1 作品にする場所を選ぶ（箕輪小版）
 * - 6つ（固定5か所＋「その他」）から1つ選ぶ。固定5か所の座標は common/places.js
 * - 「その他」：地図をタップしてピンを置く（綱島・日吉周辺の枠の中だけ）→「ここでいいかな？」で確かめる
 *   保存するのは緯度経度だけ（場所名は入力させない）
 * - 保存先：localStorage.minowa_hazardMapLog = { location:{ lat, lon, place, name } }
 *   place は apita / tsunashima / conforte / hiyoshinooka / pump / other
 *   （キーの名前は元のアプリのまま。ハザードマップの選択はなくした）
 */

const CONFIG = {
    backUrl: '../../start/index.html',
    nextUrl: '../../marbling/app/index.html',
    storageKey: 'minowa_hazardMapLog'
};

// 確認画面の「直す」から開いたとき（?edit=1）：「修正完了」で確認画面にもどる
const EDIT = /[?&]edit=1(&|$)/.test(location.search);
const CONFIRM_URL = '../../message/lastconfirm/final_submit.html';
function applyEditMode(nextBtn, backBtn) {
    if (!EDIT) return;
    nextBtn.innerHTML = window.rubyHTML('✓ 修正{しゅうせい}完了{かんりょう}');
    if (backBtn) backBtn.style.visibility = 'hidden';
    const t = document.querySelector('.step-indicator');
    if (t) t.innerHTML = '✏️ ' + window.rubyHTML('修正中{しゅうせいちゅう}');
}

// place：選んだもの（固定5か所の id か 'other'）
// otherPin：「その他」で「ここにする」を押したピンの位置 { lat, lon }
// pendingPin：タップしたが、まだ「ここにする」を押していない位置
const state = { place: null, otherPin: null, pendingPin: null, map: null, markers: {}, otherMarker: null, confirmMap: null };

const el = {
    placeButtons: document.getElementById('placeButtons'),
    locationValidation: document.getElementById('locationValidation'),
    mapInstruction: document.getElementById('mapInstruction'),
    mapToast: document.getElementById('mapToast'),
    pinConfirm: document.getElementById('pinConfirm'),
    pinOkBtn: document.getElementById('pinOkBtn'),
    pinRetryBtn: document.getElementById('pinRetryBtn'),
    backBtn: document.getElementById('backBtn'),
    nextBtn: document.getElementById('nextBtn')
};

function rb(s) { return window.rubyHTML ? window.rubyHTML(s) : s; }
const round6 = v => Math.round(v * 1e6) / 1e6;

// ---------- 保存と読み込み ----------
function loadSaved() {
    try {
        const d = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}');
        const loc = d.location;
        if (!loc || !window.minowaPlace(loc.place)) return;
        state.place = loc.place;
        if (loc.place === 'other' && window.minowaInArea(Number(loc.lat), Number(loc.lon))) {
            state.otherPin = { lat: Number(loc.lat), lon: Number(loc.lon) };
        }
    } catch (e) { console.warn(e); }
}
function save() {
    const p = window.minowaPlace(state.place);
    let location = null;
    if (p && !p.isOther) location = { lat: p.lat, lon: p.lon, place: p.id, name: p.plain };
    else if (p && p.isOther && state.otherPin) location = { lat: state.otherPin.lat, lon: state.otherPin.lon, place: 'other', name: p.plain };
    // 「その他」を選んだがまだピンを決めていないときは、場所を空にしておく（確認画面で「まだ選んでいません」になる）
    localStorage.setItem(CONFIG.storageKey, JSON.stringify({ location }));
}
function isReady() {
    const p = window.minowaPlace(state.place);
    return !!p && (!p.isOther || !!state.otherPin);
}

// ---------- 場所のボタン（6つ） ----------
function renderPlaces() {
    el.placeButtons.innerHTML = '';
    window.MINOWA_CHOICES.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'place-btn' + (p.isOther ? ' other' : '') + (state.place === p.id ? ' selected' : '');
        b.dataset.place = p.id;
        b.style.setProperty('--place-color', p.color);
        const sub = p.isOther ? '<span class="place-sub">' + rb('地図{ちず}にピンを置{お}く') + '</span>' : '';
        b.innerHTML = '<span class="place-dot"></span><span class="place-name">' + rb(p.name) + sub + '</span><span class="place-check">✓</span>';
        b.addEventListener('click', () => selectPlace(p.id));
        el.placeButtons.appendChild(b);
    });
}
function selectPlace(id) {
    state.place = id;
    el.placeButtons.querySelectorAll('.place-btn').forEach(b => b.classList.toggle('selected', b.dataset.place === id));
    el.locationValidation.style.display = 'none';
    hideToast();
    showPlaceOnMap(true);
    save(); updateNext();
}

// ---------- 地図 ----------
function placeIcon(p, selected) {
    const size = selected ? 22 : 14;
    return L.divIcon({
        className: 'place-marker' + (selected ? ' selected' : ''),
        html: '<span class="pm-dot" style="background:' + p.color + ';width:' + size + 'px;height:' + size + 'px"></span>'
            + '<span class="pm-label">' + rb(p.short) + '</span>',
        iconSize: [size, size], iconAnchor: [size / 2, size / 2]
    });
}
// 「その他」のピン（しずく形。先が地点）
function otherPinIcon() {
    return L.divIcon({
        className: 'other-pin',
        html: '<span class="op-head"></span>',
        iconSize: [34, 44], iconAnchor: [17, 42]
    });
}
function tileLayer() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    });
}
function initMap() {
    const areaB = L.latLngBounds(window.minowaAreaBounds());
    state.map = L.map('map', {
        zoomControl: true,
        maxBounds: areaB.pad(0.15), maxBoundsViscosity: 1.0, minZoom: 14
    });
    tileLayer().addTo(state.map);
    // ピンを置ける範囲：枠の外を少し暗くし、枠を線で示す
    const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    const a = window.MINOWA_AREA;
    const hole = [[a.south, a.west], [a.north, a.west], [a.north, a.east], [a.south, a.east]];
    state.areaMask = L.polygon([world, hole], { stroke: false, fillColor: '#111827', fillOpacity: 0.28, interactive: false });
    state.areaLine = L.rectangle(areaB, { color: '#dc2626', weight: 3, dashArray: '8 6', fill: false, interactive: false });

    window.MINOWA_PLACES.forEach(p => {
        state.markers[p.id] = L.marker([p.lat, p.lon], { icon: placeIcon(p, false) })
            .on('click', () => { if (state.place !== 'other') selectPlace(p.id); })
            .addTo(state.map);
    });
    state.map.on('click', onMapClick);
    showPlaceOnMap(false);
}
function showPlaceOnMap(animate) {
    if (!state.map) return;
    const p = window.minowaPlace(state.place);
    const other = !!(p && p.isOther);
    window.MINOWA_PLACES.forEach(q => {
        const m = state.markers[q.id];
        m.setIcon(placeIcon(q, q.id === state.place));
        m.setZIndexOffset(q.id === state.place ? 1000 : 0);
        m.setOpacity(other ? 0.45 : 1);
    });
    // 「その他」のときだけ、範囲の枠とピンを出す
    [state.areaMask, state.areaLine].forEach(l => { if (other) l.addTo(state.map); else state.map.removeLayer(l); });
    document.getElementById('map').classList.toggle('picking', other);
    if (state.otherMarker) { state.map.removeLayer(state.otherMarker); state.otherMarker = null; }
    if (other && state.otherPin) {
        state.otherMarker = L.marker([state.otherPin.lat, state.otherPin.lon], { icon: otherPinIcon(), zIndexOffset: 2000, interactive: false }).addTo(state.map);
    }
    if (other) {
        el.mapInstruction.innerHTML = state.otherPin
            ? rb('📍 ピンを置{お}きました。置{お}き直{なお}すときは、地図{ちず}をもう一度{いちど}タップしてね')
            : rb('👆 地図{ちず}をタップして、ピンを置{お}いてね（<span class="area-word">赤{あか}い線{せん}の中{なか}</span>だけ）');
        el.mapInstruction.classList.add('picking');
        if (state.otherPin) state.map.setView([state.otherPin.lat, state.otherPin.lon], 16, { animate: !!animate });
        else state.map.fitBounds(window.minowaAreaBounds(), { padding: [10, 10], animate: !!animate });
    } else {
        el.mapInstruction.innerHTML = rb(p ? '📍 ' + p.name : '選{えら}んだ場所{ばしょ}が地図{ちず}に出{で}ます');
        el.mapInstruction.classList.remove('picking');
        if (p) state.map.setView([p.lat, p.lon], 17, { animate: !!animate });
        else state.map.fitBounds(window.minowaPlacesBounds(), { padding: [40, 40] });
    }
}
function onMapClick(e) {
    if (state.place !== 'other') return;
    const lat = round6(e.latlng.lat), lon = round6(e.latlng.lng);
    if (!window.minowaInArea(lat, lon)) { showToast(rb('赤{あか}い線{せん}の中{なか}をタップしてね')); return; }
    hideToast();
    state.pendingPin = { lat, lon };
    openPinConfirm();
}

// ---------- 「ここでいいかな？」 ----------
function openPinConfirm() {
    const pin = state.pendingPin;
    el.pinConfirm.hidden = false;
    if (!state.confirmMap) {
        state.confirmMap = L.map('pinConfirmMap', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false });
        tileLayer().addTo(state.confirmMap);
        state.confirmMarker = L.marker([pin.lat, pin.lon], { icon: otherPinIcon(), interactive: false }).addTo(state.confirmMap);
    }
    state.confirmMarker.setLatLng([pin.lat, pin.lon]);
    setTimeout(() => { state.confirmMap.invalidateSize(); state.confirmMap.setView([pin.lat, pin.lon], 17, { animate: false }); }, 30);
    el.pinOkBtn.focus();
}
function closePinConfirm() { el.pinConfirm.hidden = true; }
function confirmPin() {
    if (!state.pendingPin) return;
    state.otherPin = state.pendingPin;
    state.pendingPin = null;
    closePinConfirm();
    showPlaceOnMap(false);
    save(); updateNext();
}
function retryPin() {
    state.pendingPin = null;
    closePinConfirm();
}

let toastTimer = null;
function showToast(html) {
    el.mapToast.innerHTML = html; el.mapToast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 2500);
}
function hideToast() { el.mapToast.hidden = true; }

// ---------- つぎへ・もどる ----------
function updateNext() { el.nextBtn.disabled = !isReady(); }
function handleNext() {
    if (!isReady()) {
        el.locationValidation.innerHTML = rb(state.place === 'other' ? '⚠️ 地図{ちず}をタップして、ピンを置{お}いてください' : '⚠️ 場所{ばしょ}を選{えら}んでください');
        el.locationValidation.style.display = 'block';
        return;
    }
    save();
    location.href = EDIT ? CONFIRM_URL : CONFIG.nextUrl;
}

document.addEventListener('DOMContentLoaded', () => {
    loadSaved();
    renderPlaces();
    initMap();
    updateNext();
    applyEditMode(el.nextBtn, el.backBtn);
    el.pinOkBtn.addEventListener('click', confirmPin);
    el.pinRetryBtn.addEventListener('click', retryPin);
    el.backBtn.addEventListener('click', () => { save(); location.href = CONFIG.backUrl; });
    el.nextBtn.addEventListener('click', handleNext);
});
