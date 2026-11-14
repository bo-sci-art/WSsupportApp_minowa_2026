/**
 * S8 確認して登録（箕輪小版・授業案 rev3）
 * 入力内容と作品画像を Cloudflare Worker（POST /submit）に送り、D1（文章・地点）と R2（画像）に登録する。
 *
 * 送る項目（Worker の properties）
 * - Message  : 作品のタイトル
 * - Body     : この作品で伝えたいこと
 * - field_23 : いつの行動か（事前／災害時／復旧時）
 * - field_24 : 使わない（箕輪小版はハザードマップを選ばない。空のまま送る）
 * - field_25 : 作者の番号（4601〜4640）
 * - place    : 地点の種類（apita / tsunashima / conforte / hiyoshinooka / pump / other）
 *   lat / lon : 固定5か所はその場所の固定の座標、other は児童が地図に置いたピンの座標
 * - Mabling・collage は使わない（空のまま）
 * 作品画像：localStorage.artworkImage（コラージュの自動保存で作られる）
 */

const CONFIG = {
    // Cloudflare Worker の URL（作品の受付窓口）。デプロイ後に URL が違っていたらここと common/config.js を直す
    WORKER_URL: 'https://minowa-submit.kazuki131214.workers.dev',
    // Worker の SUBMIT_SECRET と同じ値（ページのソースを見ればだれでも分かる。ADMIN_KEY はここに書かない）
    SUBMIT_SECRET: 'minowa-ws-2026',
    PAGES: {
        artwork: '../artwork/artwork_submit.html',
        artworkEdit: '../artwork/artwork_submit.html?edit=1',
        placeEdit: '../../map/Log/log_hazard_map.html?edit=1',
        marblingApp: '../../marbling/app/index.html?edit=1',   // 作り直し（修正完了で確認画面にもどる）
        collageApp: '../../collage/app/index.html?edit=1',
        map: '../../present/index.html'
    }
};
function workerBase() { return ((window.MINOWA_CONFIG && window.MINOWA_CONFIG.WORKER_URL) || CONFIG.WORKER_URL).replace(/\/+$/, ''); }

let appData = { location: null, art: {} };
let isSubmitting = false;

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function rb(s) { return window.rubyHTML ? window.rubyHTML(s) : s; }

function loadData() {
    const h = readJSON('minowa_hazardMapLog');
    appData.location = validLocation(h.location) ? h.location : null;
    appData.art = readJSON('minowa_artworkSubmit');
}
// 選んだ地点が正しいか（固定5か所のどれか、または「その他」で範囲内のピン）
function validLocation(loc) {
    if (!loc) return false;
    const p = window.minowaPlace(loc.place);
    if (!p) return false;
    return p.isOther ? window.minowaInArea(Number(loc.lat), Number(loc.lon)) : true;
}
// 送る座標：固定5か所は places.js の座標、「その他」はピンの座標
function locationLatLon(loc) {
    const p = window.minowaPlace(loc.place);
    return p.isOther ? { lat: Number(loc.lat), lon: Number(loc.lon) } : { lat: p.lat, lon: p.lon };
}

// ---------- 確認の一覧 ----------
function row(label, valueHTML, editKey, empty) {
    return '<div class="s8-row' + (empty ? ' empty' : '') + '">'
        + '<div class="s8-row-label">' + rb(label) + '</div>'
        + '<div class="s8-row-value">' + valueHTML + '</div>'
        + '<button type="button" class="s8-edit" data-edit="' + editKey + '">✏️ ' + rb('直{なお}す') + '</button>'
        + '</div>';
}
function renderSummary() {
    const a = appData.art;
    const place = appData.location && window.minowaPlace(appData.location.place);
    const NONE = rb('（まだ入力{にゅうりょく}していません）');
    const NONE_SEL = rb('（まだ選{えら}んでいません）');
    const html = [
        row('タイトル', a.title ? '<span class="s8-v-title" data-user-text>' + esc(a.title) + '</span>' : NONE, 'artwork', !a.title),
        row('伝{つた}えたいこと', a.body ? '<span class="s8-v-body" data-user-text>' + esc(a.body) + '</span>' : NONE, 'artwork', !a.body),
        row('いつの行動{こうどう}', a.phase ? '<span class="s8-tag">' + rb(window.minowaPhaseLabel(a.phase)) + '</span>' : NONE_SEL, 'artwork', !a.phase),
        row('番号{ばんごう}', window.MINOWA_NUMBER_RE.test(a.number || '') ? '<span class="s8-v-num">' + esc(a.number) + '</span>' : NONE, 'artwork', !window.MINOWA_NUMBER_RE.test(a.number || '')),
        row('作品{さくひん}にする場所{ばしょ}', place ? '📍 ' + rb(place.name) + (place.isOther ? ' <span class="s8-v-sub">' + rb('（地図{ちず}にピンを置{お}いた場所{ばしょ}）') + '</span>' : '') : NONE_SEL, 'place', !place)
    ].join('');
    const list = document.getElementById('summaryList');
    list.innerHTML = html;
    list.querySelectorAll('.s8-edit').forEach(b => b.addEventListener('click', () => {
        location.href = b.dataset.edit === 'place' ? CONFIG.PAGES.placeEdit : CONFIG.PAGES.artworkEdit;
    }));
}
function missingItems() {
    const a = appData.art, m = [];
    if (!a.title) m.push('タイトル');
    if (!a.body) m.push('伝えたいこと');
    if (!a.phase) m.push('いつの行動か');
    if (!window.MINOWA_NUMBER_RE.test(a.number || '')) m.push('番号');
    if (!appData.location) m.push('場所');
    return m;
}

// ---------- 作品画像 ----------
function wsIdbGet(key) {
    return new Promise(function (resolve) {
        try {
            const req = indexedDB.open('minowa_ws_art_db', 1);
            req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains('images')) req.result.createObjectStore('images'); };
            req.onsuccess = function () {
                try {
                    const g = req.result.transaction('images', 'readonly').objectStore('images').get(key);
                    g.onsuccess = function () { resolve(g.result || null); };
                    g.onerror = function () { resolve(null); };
                } catch (e) { resolve(null); }
            };
            req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
    });
}
function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
}
function loadImg(src) {
    return new Promise(function (resolve, reject) { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}
// マーブリング画像＋スタンプ配置から作品画像を作り直す（自動保存の画像が見つからないときの予備）
async function rebuildArtworkFromParts() {
    const base = await wsIdbGet('latest_marbling_base');
    if (!base) return null;
    const baseImg = await loadImg(URL.createObjectURL(base));
    const scale = Math.min(1, 1000 / Math.max(baseImg.naturalWidth, baseImg.naturalHeight));
    const W = Math.round(baseImg.naturalWidth * scale), H = Math.round(baseImg.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(baseImg, 0, 0, W, H);
    const saved = await wsIdbGet('collage_stamps');
    for (const d of ((saved && saved.stamps) || [])) {
        const name = String(d.name || '').replace(/(-[0-9]+)+$/, '');
        let tex;
        try { tex = await loadImg('../../collage/app/detail/asset/stamps/' + name + '.png'); } catch (e) { continue; }
        const w = d.nw * W, h = w * (tex.naturalHeight / tex.naturalWidth);
        let src = tex;
        if (d.color && d.color.toLowerCase() !== '#ffffff') {
            const t = document.createElement('canvas'); t.width = tex.naturalWidth; t.height = tex.naturalHeight;
            const tc = t.getContext('2d');
            tc.drawImage(tex, 0, 0); tc.globalCompositeOperation = 'source-in';
            tc.fillStyle = d.color; tc.fillRect(0, 0, t.width, t.height);
            src = t;
        }
        ctx.save();
        ctx.globalAlpha = d.alpha == null ? 0.68 : d.alpha;
        ctx.translate(d.nx * W, d.ny * H);
        ctx.rotate((d.angleDeg || 0) * Math.PI / 180);
        ctx.scale(d.flipX ? -1 : 1, d.flipY ? -1 : 1);
        ctx.drawImage(src, -w / 2, -h / 2, w, h);
        ctx.restore();
    }
    return c.toDataURL('image/jpeg', 0.85);
}
// 作品画像を必ず用意する：localStorage → IndexedDB（コラージュの自動保存）→ 部品から作り直し
async function ensureArtworkImage() {
    if (localStorage.getItem('minowa_artworkImage')) return;
    try {
        const blob = await wsIdbGet('artwork_image');
        let dataURL = blob ? await blobToDataURL(blob) : null;
        if (!dataURL) dataURL = await rebuildArtworkFromParts();
        if (dataURL) { localStorage.setItem('minowa_artworkImage', dataURL); localStorage.setItem('minowa_artworkImageExt', 'jpg'); }
    } catch (e) { console.error('作品画像の用意に失敗', e); }
}
function showArtwork() {
    const img = document.getElementById('artwork-preview-img');
    const empty = document.getElementById('artwork-preview-empty');
    const data = localStorage.getItem('minowa_artworkImage');
    if (data) { img.src = data; img.style.display = 'block'; empty.style.display = 'none'; }
    else { img.style.display = 'none'; empty.style.display = 'flex'; empty.innerHTML = rb('作品{さくひん}の絵{え}が見{み}つかりません。「コラージュを作{つく}り直{なお}す」を押{お}してください。'); }
}

// ---------- 送信 ----------
function buildSubmitPayload(imageDataURL) {
    const a = appData.art;
    const place = window.minowaPlace(appData.location.place);
    const ll = locationLatLon(appData.location);
    return {
        secret: CONFIG.SUBMIT_SECRET,
        lat: ll.lat,
        lon: ll.lon,
        properties: {
            field_23: a.phase || null,
            field_24: null,
            field_25: a.number,
            Message: a.title || '',
            Body: a.body || '',
            place: place.id,
            creationDate: a.creationDate || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
        },
        imageBase64: imageDataURL,
        imageExt: localStorage.getItem('minowa_artworkImageExt') || 'jpg'
    };
}
async function submitArtwork() {
    if (isSubmitting) return;
    loadData();
    const miss = missingItems();
    if (miss.length) { setStatus('error', 'まだ入{はい}っていない項目{こうもく}があります：' + miss.join('・')); return; }
    const imageDataURL = localStorage.getItem('minowa_artworkImage');
    if (!imageDataURL) { setStatus('error', '作品{さくひん}の絵{え}が見{み}つかりません。「コラージュを作{つく}り直{なお}す」を押{お}してください。'); return; }
    prepareArtworkFile(imageDataURL);
    await sendSubmitPayload(buildSubmitPayload(imageDataURL));
}
async function sendSubmitPayload(payload) {
    isSubmitting = true;
    setButton('sending');
    setStatus('info', '登録{とうろく}しています。少{すこ}し待{ま}ってください…');
    try {
        localStorage.setItem('minowa_pendingArtworkSubmitPayload', JSON.stringify(payload));
        const res = await fetch(workerBase() + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        let json = null;
        try { json = await res.json(); } catch (e) { /* ignore */ }
        if (res.ok && json && json.ok) {
            localStorage.removeItem('minowa_pendingArtworkSubmitPayload');
            if (json.id) localStorage.setItem('minowa_lastSubmittedArtworkId', json.id);
            setButton('success');
            setStatus(null);
            saveArtworkToDevice(json.id);   // 登録できた時点で、この端末に作品を自動で保存する
            showCompletion();
        } else {
            setButton('error');
            setStatus('error', '送信{そうしん}できませんでした。先生{せんせい}を呼{よ}んでください（' + ((json && json.error) ? json.error : 'status ' + res.status) + '）');
        }
    } catch (err) {
        console.error('送信エラー:', err);
        setButton('error');
        setStatus('error', 'インターネットにつながりませんでした。もう一度{いちど}押{お}してください。それでもだめなときは先生{せんせい}を呼{よ}んでください。');
    } finally {
        isSubmitting = false;
    }
}
function setButton(state) {
    const btn = document.getElementById('btn-submit-artwork');
    if (state === 'sending') { btn.disabled = true; btn.innerHTML = rb('送信{そうしん}しています…'); }
    else if (state === 'success') { btn.disabled = true; btn.innerHTML = rb('✅ 登録{とうろく}できました'); }
    else { btn.disabled = false; btn.innerHTML = rb('📤 もう一度{いちど}送信{そうしん}する'); }
}
function setStatus(kind, msg) {
    const el = document.getElementById('submit-status');
    if (!kind) { el.style.display = 'none'; return; }
    el.className = 's8-status ' + kind;
    el.innerHTML = (kind === 'error' ? '⚠ ' : '') + rb(msg);
    el.style.display = 'block';
}
function showCompletion() { document.getElementById('step-complete').style.display = 'flex'; }

// 前回の送信が終わっていない（電波が切れたなど）ときは、もう一度送れるようにする
function checkPendingSubmission() {
    const pending = localStorage.getItem('minowa_pendingArtworkSubmitPayload');
    if (!pending) return;
    setStatus('info', 'まだ送{おく}れていない作品{さくひん}があります。「登録{とうろく}する」を押{お}すと、もう一度{いちど}送{おく}ります。');
}

// ---------- 作り直し・移動 ----------
function redoWork(page) {
    const msg = page === 'marblingApp'
        ? 'マーブリングを作り直す画面を開きます。\n「修正完了」を押すと、この画面に戻ります。\n（コラージュのスタンプと入力した内容は残ります）'
        : 'コラージュを作り直す画面を開きます。\n「修正完了」を押すと、この画面に戻ります。\n（入力した内容は残ります）';
    if (confirm(msg)) location.href = CONFIG.PAGES[page];
}
window.redoWork = redoWork;
function goToMap() {
    const p = appData.location && appData.location.place;
    location.href = CONFIG.PAGES.map + (p ? '?place=' + encodeURIComponent(p) : '');
}
window.goToMap = goToMap;

// ---------- 登録できたら、作品をこの端末（iPad・PC）に自動で保存する ----------
// ・「登録する」を押したときに画像ファイルを用意しておき、登録できたらすぐ保存する（待ち時間で止められないように）
// ・同じ作品を二重に保存しないように、保存した作品の id を覚えておく（画面を開き直しても、もう一度は保存しない）
// ・iPad は「ファイル」アプリの「ダウンロード」、PC はブラウザの「ダウンロード」フォルダに入る
let artworkFileUrl = null;
function prepareArtworkFile(dataURL) {
    try {
        if (artworkFileUrl) URL.revokeObjectURL(artworkFileUrl);
        const m = /^data:([^;,]+);base64,(.*)$/.exec(dataURL || '');
        if (!m) { artworkFileUrl = null; return; }
        const bin = atob(m[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        artworkFileUrl = URL.createObjectURL(new Blob([bytes], { type: m[1] }));
    } catch (e) { console.error('保存する画像を用意できませんでした', e); artworkFileUrl = null; }
}
function saveArtworkToDevice(id) {
    const note = document.getElementById('download-note');
    try {
        if (id && localStorage.getItem('minowa_artworkSavedId') === String(id)) return;   // もう保存してある
        if (!artworkFileUrl) prepareArtworkFile(localStorage.getItem('minowa_artworkImage'));
        if (!artworkFileUrl) throw new Error('no image');
        const a = document.createElement('a');
        a.href = artworkFileUrl;
        a.download = 'minowa_' + (id ? id + '_' : '') + (appData.art.number || 'sakuhin') + '.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        if (id) localStorage.setItem('minowa_artworkSavedId', String(id));
        if (note) { note.className = 's8-download-note'; note.innerHTML = rb('✓ 作品{さくひん}をこの端末{たんまつ}に保存{ほぞん}しました（iPad は「ファイル」アプリの「ダウンロード」に入{はい}ります）'); note.style.display = 'block'; }
    } catch (e) {
        console.error('作品の保存に失敗', e);
        if (note) { note.className = 's8-download-note error'; note.innerHTML = rb('作品{さくひん}を端末{たんまつ}に保存{ほぞん}できませんでした。登録{とうろく}はできています。'); note.style.display = 'block'; }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    loadData();
    renderSummary();
    document.getElementById('btn-back').addEventListener('click', () => { location.href = CONFIG.PAGES.artwork; });
    document.getElementById('btn-submit-artwork').addEventListener('click', submitArtwork);
    checkPendingSubmission();
    // 登録が終わったあとにこの画面を開き直したときは、二重に登録しないように完了画面を出す
    if (localStorage.getItem('minowa_lastSubmittedArtworkId')) { setButton('success'); showCompletion(); }
    await ensureArtworkImage();
    showArtwork();
});
