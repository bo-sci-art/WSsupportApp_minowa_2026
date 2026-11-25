// minowa-submit：箕輪小版 防災アートの作品登録 Worker
//   作品の文章・地点 → Cloudflare D1（テーブル artworks）
//   作品画像         → Cloudflare R2（バケット minowa-artworks）
//
// エンドポイント
//   POST   /submit          作品の登録（アプリの buildSubmitPayload の形をそのまま受け取る）→ { ok:true, id }
//   GET    /artworks        作品一覧（GeoJSON、項目名は大人版の artworks.geojson と同じ）。キャッシュしない
//   GET    /images/:key     R2 の画像
//   GET    /export          全作品を GeoJSON でダウンロード（ADMIN_KEY が必要）
//   DELETE /artworks/:id    作品を1件削除（画像も消す。ADMIN_KEY が必要）
//   PATCH  /artworks/:id    作品の公開・非公開を切り替える（{ "status": "approved" | "hidden" }。ADMIN_KEY が必要）
//   PUT    /artworks/:id    作品の情報を直す（ペンネーム・タイトル・伝えたいこと・場所・いつの行動か・作品にする災害。ADMIN_KEY が必要）
//                           送られてきた項目だけを直す。画像・status・created_at は変えない。extra.updated_at に直した日時を残す
//                           場所を「その他」にするときは lat・lon（ピンの位置。AREA の中）もいっしょに送る（下の updateArtwork を参照）
//
// シークレット（wrangler secret put で登録）
//   SUBMIT_SECRET  アプリが送る合言葉（アプリのコードに書かれるので、だれでも見られる）
//   ADMIN_KEY      管理用の合言葉（アプリには書かない）。Authorization: Bearer <ADMIN_KEY> で送る
//
// 環境変数（wrangler.toml の [vars]）
//   ALLOWED_ORIGINS    CORS を許可するオリジン（カンマ区切り）。localhost / 127.0.0.1 は常に許可
//   REGISTRATION_OPEN  "false" にすると POST /submit を止める（403 registration closed）。ないときは受け付ける。
//                      一覧・画像・管理（/export・PUT・PATCH・DELETE）は、止めているときも使える

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;          // 画像の上限（1000px JPEG なら 0.3MB 前後）
const MAX_TEXT = { field_23: 100, field_24: 500, field_25: 100, Message: 300, Body: 1000, place: 20, collage: 3000, Mabling: 3000, hazard: 500, target: 200, creationDate: 20 };
// 箕輪小版：作者は「ペンネーム」（列は field_25 のまま）。出席番号は使わない（使うには保護者の許可がいるため）
//   文字数の決まりはない（データベースが大きくなりすぎないよう、MAX_TEXT の 100 文字で切るだけ）。改行や制御文字は入れない。だれかと同じでもよい
//   空白は1つにまとめ、前後の空白はとる。※ workshop/common/places.js の minowaPenName と同じ決まりにする
function penName(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\s　]+/g, " ").trim();
  if (!s || /[\u0000-\u001F\u007F]/.test(s)) return null;
  return s;
}
// 地点の種類：固定5か所のどれか、または「その他」（児童が地図にピンを置いた場所）
//   ※ workshop/common/places.js の MINOWA_PLACES の id と同じにする
const PLACES = ["apita", "shintsunashima", "conforte", "hiyoshinooka", "pump", "other"];
// 綱島・日吉周辺：これより外の地点は受け付けない（places.js の MINOWA_AREA と同じ）
const AREA = { south: 35.525, north: 35.565, west: 139.620, east: 139.670 };
// 固定5か所の座標（workshop/common/places.js の MINOWA_PLACES と同じ値にすること）。作品の場所を固定の場所に直したとき、ピンをここに移す
const PLACE_COORDS = {
  apita:          { lat: 35.54195,    lon: 139.641434 },
  shintsunashima: { lat: 35.536551,   lon: 139.636642 },
  conforte:       { lat: 35.546082,   lon: 139.634018 },
  hiyoshinooka:   { lat: 35.548008,   lon: 139.642441 },
  pump:           { lat: 35.53960528, lon: 139.65348008 }
};
// いつの行動か（保存する値）。作品を直すときに確かめる
const PHASES = ["事前", "災害時", "復旧時"];
// 作品にする災害（field_24。いくつでも、カンマ区切り）。授業の「作品の計画シート」の8つ。
//   値は既存アプリ（大人版）と同じ正式名。workshop/common/places.js の MINOWA_HAZARDS と同じ値・同じ順にする
//   登録のときは、入っていればこの中の値かを確かめる（2026/11/25 より前の作品と古い画面のために、空でも受け付ける）
const HAZARDS = ["洪水（外水氾濫）", "内水氾濫", "高潮", "土砂災害（急傾斜地の崩壊）", "地震の揺れ（震度）", "津波", "液状化危険度", "地震火災（焼失棟数）"];
// 災害の値を確かめて、選択肢の順にならべる。ちがう値があれば { bad:[…] }
function hazardList(v) {
  const list = listOf(v);
  const bad = list.filter(x => HAZARDS.indexOf(x) < 0);
  if (bad.length) return { bad };
  return { value: HAZARDS.filter(h => list.indexOf(h) >= 0).join(", ") || null };
}
const inArea = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= AREA.south && lat <= AREA.north && lon >= AREA.west && lon <= AREA.east;
const TEXT_FIELDS = Object.keys(MAX_TEXT);
const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "POST" && (path === "/submit" || path === "/")) return await submit(request, env, cors);
      if (request.method === "GET" && path === "/artworks") return await listArtworks(env, cors, url);
      if (request.method === "GET" && path.startsWith("/images/")) return await getImage(path.slice(8), env, cors);
      if (request.method === "GET" && path === "/export") return await exportAll(request, env, cors, url);
      if (request.method === "DELETE" && path.startsWith("/artworks/")) return await deleteArtwork(request, path.slice(10), env, cors, url);
      if (request.method === "PATCH" && path.startsWith("/artworks/")) return await setArtworkStatus(request, path.slice(10), env, cors);
      if (request.method === "PUT" && path.startsWith("/artworks/")) return await updateArtwork(request, path.slice(10), env, cors);
      if (request.method === "GET" && path === "/") return json({ ok: true, name: "minowa-submit" }, 200, cors);

      return json({ ok: false, error: "not found" }, 404, cors);
    } catch (e) {
      console.error(e && e.stack || e);
      return json({ ok: false, error: "server error" }, 500, cors);
    }
  }
};

// ---------------------------------------------------------------------------
// POST /submit
// ---------------------------------------------------------------------------
async function submit(request, env, cors) {
  // 作品の受け付けを止めているとき（授業が終わったあと）。wrangler.toml の [vars] REGISTRATION_OPEN = "false"
  // 値がないときは受け付ける（ほかの学校版に移すときに、そのまま使えるように）
  if (!registrationOpen(env)) {
    return json({ ok: false, error: "registration closed", message: "作品の登録の受け付けは終わりました" }, 403, cors);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "invalid json" }, 400, cors); }

  if (!env.SUBMIT_SECRET || !safeEqual(String(body.secret || ""), env.SUBMIT_SECRET)) {
    return json({ ok: false, error: "secret mismatch" }, 403, cors);
  }

  const lat = Number(body.lat), lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: "invalid location" }, 400, cors);
  }
  if (lat < AREA.south || lat > AREA.north || lon < AREA.west || lon > AREA.east) {
    return json({ ok: false, error: "location out of area" }, 400, cors);
  }

  const props = body.properties && typeof body.properties === "object" ? body.properties : {};
  const fields = {};
  for (const k of TEXT_FIELDS) {
    const v = props[k];
    fields[k] = (v === null || v === undefined) ? null : String(v).slice(0, MAX_TEXT[k]);
  }
  fields.field_25 = penName(fields.field_25);
  if (!fields.field_25) return json({ ok: false, error: "invalid penname" }, 400, cors);
  if (!fields.place || PLACES.indexOf(fields.place) < 0) return json({ ok: false, error: "invalid place" }, 400, cors);
  const hz = hazardList(props.field_24);
  if (hz.bad) return json({ ok: false, error: "invalid hazard", values: hz.bad }, 400, cors);
  fields.field_24 = hz.value;
  if (!fields.creationDate) fields.creationDate = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  // 画像（data URL か base64）
  const img = decodeImage(body.imageBase64, body.imageExt);
  if (img.error) return json({ ok: false, error: img.error }, 400, cors);

  // 1) 画像を R2 に保存（キーは推測しにくいランダムな値）
  const imageKey = crypto.randomUUID() + "." + img.ext;
  await env.IMAGES.put(imageKey, img.bytes, { httpMetadata: { contentType: img.type } });

  // 2) D1 に1行追加（id は D1 が採番するので、同時に登録しても衝突しない）
  let id;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO artworks (lat, lon, field_23, field_24, field_25, Message, collage, Mabling, hazard, target, creationDate, image_key, status, created_at, Body, place)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'approved', ?13, ?14, ?15) RETURNING id`
    ).bind(lat, lon, fields.field_23, fields.field_24, fields.field_25, fields.Message, fields.collage, fields.Mabling,
           fields.hazard, fields.target, fields.creationDate, imageKey, new Date().toISOString(), fields.Body, fields.place).first();
    id = row && row.id;
  } catch (e) {
    await env.IMAGES.delete(imageKey).catch(() => {});   // 画像だけ残らないように
    throw e;
  }

  return json({ ok: true, id: String(id) }, 200, cors);
}

function decodeImage(src, extIn) {
  if (!src || typeof src !== "string") return { error: "image missing" };
  let b64 = src, type = null;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(src);
  if (m) { type = m[1].toLowerCase(); b64 = m[2]; }
  let ext = String(extIn || "").toLowerCase().replace(/[^a-z]/g, "");
  if (type) ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type] || ext;
  if (!IMAGE_TYPES[ext]) ext = "jpg";
  if (b64.length > MAX_IMAGE_BYTES * 4 / 3 + 4) return { error: "image too large" };
  let bytes;
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) { return { error: "invalid image" }; }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { error: "invalid image size" };
  return { bytes, ext, type: IMAGE_TYPES[ext] };
}

// ---------------------------------------------------------------------------
// GET /artworks（公開：status='approved' のみ）／ GET /export（管理：全件）
// ---------------------------------------------------------------------------
async function listArtworks(env, cors) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM artworks WHERE status = 'approved' ORDER BY id ASC`
  ).all();
  return json(toGeoJSON(results), 200, { ...cors, "Cache-Control": "no-store" });
}

async function exportAll(request, env, cors, url) {
  if (!isAdmin(request, env, url)) return json({ ok: false, error: "unauthorized" }, 401, cors);
  const { results } = await env.DB.prepare(`SELECT * FROM artworks ORDER BY id ASC`).all();
  const gj = toGeoJSON(results, true);
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(JSON.stringify(gj, null, 2), {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/geo+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="minowa_artworks_${stamp}.geojson"`,
      "Cache-Control": "no-store"
    }
  });
}

// 大人版の artworks.geojson と同じ形・同じ項目名
function toGeoJSON(rows, includeAdmin) {
  return {
    type: "FeatureCollection",
    features: (rows || []).map(r => {
      const properties = {
        id: String(r.id),
        field_23: r.field_23,
        field_24: r.field_24,
        field_25: r.field_25,
        Message: r.Message,
        Body: r.Body,
        place: r.place,
        collage: r.collage,
        Mabling: r.Mabling,
        creationDate: r.creationDate,
        images: r.image_key ? ["images/" + r.image_key] : [],
        status: r.status
      };
      if (r.hazard != null) properties.hazard = r.hazard;
      if (r.target != null) properties.target = r.target;
      if (includeAdmin) {
        properties.created_at = r.created_at;
        const ex = parseExtra(r.extra);
        if (ex.updated_at) properties.updated_at = ex.updated_at;
        if (ex.original_pin) properties.original_pin = ex.original_pin;   // 「その他」から固定の場所に直した作品の、もとのピン
      }
      return { type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties };
    })
  };
}

// ---------------------------------------------------------------------------
// GET /images/:key
// ---------------------------------------------------------------------------
async function getImage(key, env, cors) {
  key = decodeURIComponent(key);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(key)) return json({ ok: false, error: "bad key" }, 400, cors);
  const obj = await env.IMAGES.get(key);
  if (!obj) return json({ ok: false, error: "not found" }, 404, cors);
  const headers = new Headers(cors);
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");   // キーは作品ごとに一意で、中身は変わらない
  return new Response(obj.body, { headers });
}

// ---------------------------------------------------------------------------
// DELETE /artworks/:id
// ---------------------------------------------------------------------------
async function deleteArtwork(request, idStr, env, cors, url) {
  if (!isAdmin(request, env, url)) return json({ ok: false, error: "unauthorized" }, 401, cors);
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "bad id" }, 400, cors);
  const row = await env.DB.prepare(`SELECT image_key FROM artworks WHERE id = ?1`).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404, cors);
  await env.DB.prepare(`DELETE FROM artworks WHERE id = ?1`).bind(id).run();
  if (row.image_key) await env.IMAGES.delete(row.image_key).catch(() => {});
  return json({ ok: true, id: String(id), deleted: true }, 200, cors);
}

// ---------------------------------------------------------------------------
// PATCH /artworks/:id（公開・非公開の切り替え。データは消さない）
// ---------------------------------------------------------------------------
const STATUSES = ["approved", "hidden"];
async function setArtworkStatus(request, idStr, env, cors) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "unauthorized" }, 401, cors);
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "bad id" }, 400, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "invalid json" }, 400, cors); }
  const status = body && typeof body === "object" ? body.status : undefined;
  if (typeof status !== "string" || STATUSES.indexOf(status) < 0) return json({ ok: false, error: "invalid status" }, 400, cors);
  const row = await env.DB.prepare(`SELECT id FROM artworks WHERE id = ?1`).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404, cors);
  await env.DB.prepare(`UPDATE artworks SET status = ?1 WHERE id = ?2`).bind(status, id).run();
  return json({ ok: true, id: String(id), status }, 200, cors);
}

// ---------------------------------------------------------------------------
// PUT /artworks/:id（作品の情報を直す。先生が管理画面から使う）
// ---------------------------------------------------------------------------
// field_24 は「作品にする災害」（2026/11/25 から。空にもできる）
const EDITABLE = ["field_23", "field_24", "field_25", "Message", "Body", "place"];
function listOf(v) {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,、]\s*/);
  return arr.map(x => String(x).trim()).filter(Boolean);
}
function parseExtra(t) {
  if (!t) return {};
  try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
async function updateArtwork(request, idStr, env, cors) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "unauthorized" }, 401, cors);
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "bad id" }, 400, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "invalid json" }, 400, cors); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid json" }, 400, cors);

  const set = {};
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === "field_23") {
      const list = listOf(v);
      const bad = list.filter(x => PHASES.indexOf(x) < 0);
      if (bad.length) return json({ ok: false, error: "invalid phase", field: k, values: bad }, 400, cors);
      const joined = Array.from(new Set(list)).join(", ");
      if (joined.length > MAX_TEXT[k]) return json({ ok: false, error: "too long", field: k, max: MAX_TEXT[k] }, 400, cors);
      set[k] = joined || null;
      continue;
    }
    if (k === "field_24") {
      const hz = hazardList(v);
      if (hz.bad) return json({ ok: false, error: "invalid hazard", field: k, values: hz.bad }, 400, cors);
      set[k] = hz.value;
      continue;
    }
    if (v !== null && typeof v !== "string" && typeof v !== "number") return json({ ok: false, error: "invalid value", field: k }, 400, cors);
    let str = v === null ? null : String(v).trim();
    if (k === "field_25") {
      str = penName(str);
      if (!str) return json({ ok: false, error: "invalid penname", field: k }, 400, cors);
    } else if (k === "place") {
      if (!str || PLACES.indexOf(str) < 0) return json({ ok: false, error: "invalid place", field: k }, 400, cors);
    }
    if (str !== null && str.length > MAX_TEXT[k]) return json({ ok: false, error: "too long", field: k, max: MAX_TEXT[k] }, 400, cors);
    set[k] = str === "" ? null : str;
  }
  // ピンの位置（「その他」のときだけ使う）
  const hasPin = ("lat" in body) || ("lon" in body);
  const pin = hasPin ? { lat: Number(body.lat), lon: Number(body.lon) } : null;
  if (hasPin && !inArea(pin.lat, pin.lon)) return json({ ok: false, error: "location out of area", field: "lat" }, 400, cors);
  if (!Object.keys(set).length && !hasPin) return json({ ok: false, error: "nothing to update" }, 400, cors);

  const row = await env.DB.prepare(`SELECT * FROM artworks WHERE id = ?1`).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404, cors);
  const extra = parseExtra(row.extra);

  // 場所と座標（案A）
  //   固定 → 固定     ：その場所の座標に移す
  //   その他 → 固定   ：その場所の座標に移し、児童が置いたピンを extra.original_pin に残す（あとで「その他」に戻すとき使う）
  //   固定 → その他   ：lat・lon（管理画面の地図で置いたピン）が必要。送られてこないときは extra.original_pin を使う。どちらもなければ 400
  //   その他 → その他 ：lat・lon が送られてきたときだけ、ピンを動かす
  const newPlace = set.place || row.place;
  if (newPlace === "other") {
    if (pin) { set.lat = pin.lat; set.lon = pin.lon; }
    else if (row.place !== "other") {
      const op = extra.original_pin;
      if (op && inArea(Number(op.lat), Number(op.lon))) { set.lat = Number(op.lat); set.lon = Number(op.lon); }
      else return json({ ok: false, error: "pin required", field: "lat" }, 400, cors);
    }
  } else {
    if (pin) return json({ ok: false, error: "pin only for other", field: "lat" }, 400, cors);
    if (set.place && set.place !== row.place && PLACE_COORDS[set.place]) {
      if (row.place === "other" && inArea(Number(row.lat), Number(row.lon))) extra.original_pin = { lat: row.lat, lon: row.lon };
      set.lat = PLACE_COORDS[set.place].lat; set.lon = PLACE_COORDS[set.place].lon;
    }
  }
  // 直した日時を extra に残す（extra にほかの項目が入っていたら、そのまま残す）
  extra.updated_at = new Date().toISOString();
  set.extra = JSON.stringify(extra);

  // 列名は EDITABLE と lat/lon/extra だけ（利用者の文字は bind で渡す）
  const cols = Object.keys(set);
  const sql = `UPDATE artworks SET ${cols.map((c, i) => c + " = ?" + (i + 1)).join(", ")} WHERE id = ?${cols.length + 1}`;
  await env.DB.prepare(sql).bind(...cols.map(c => set[c]), id).run();

  const after = await env.DB.prepare(`SELECT * FROM artworks WHERE id = ?1`).bind(id).first();
  const feature = toGeoJSON([after], true).features[0];
  return json({ ok: true, id: String(id), feature, properties: feature.properties }, 200, cors);
}

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------
function registrationOpen(env) {
  return String(env.REGISTRATION_OPEN == null ? "true" : env.REGISTRATION_OPEN).trim().toLowerCase() !== "false";
}

function isAdmin(request, env) {
  if (!env.ADMIN_KEY) return false;
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return !!m && safeEqual(m[1].trim(), env.ADMIN_KEY);
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && (isLocal || allowed.includes(origin))) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...(headers || {}), "Content-Type": "application/json; charset=utf-8" }
  });
}
