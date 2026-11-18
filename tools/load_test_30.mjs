// N件（初期値 40件：4年6組の番号 4601〜4640 の数）の作品を同時に登録して、全件が登録されるかを確かめるテスト
//
// 使い方（Node.js 18 以上）:
//   node tools/load_test_30.mjs <WorkerのURL> <ADMIN_KEY> [件数=40]
//   例）node tools/load_test_30.mjs https://minowa-submit.kazuki131214.workers.dev XXXXXXXX
//
// 流れ:
//   1. いまの作品数を数える
//   2. N件を「同時に」POST /submit する（画像は 1000px 前後の大きさのダミー）
//   3. GET /artworks で、送った N件が全部あるか確かめる（登録した直後に見えるか）
//   4. テストで登録した作品を DELETE /artworks/:id で消す（--keep をつけると消さない）
//
// ※ SUBMIT_SECRET は環境変数 SUBMIT_SECRET で変えられる（初期値はアプリと同じ）

const [, , base0, adminKey, n0] = process.argv.filter(a => a !== "--keep");
const KEEP = process.argv.includes("--keep");
if (!base0 || !adminKey) {
  console.error("使い方: node tools/load_test_30.mjs <WorkerのURL> <ADMIN_KEY> [件数=40] [--keep]");
  process.exit(1);
}
const BASE = base0.replace(/\/+$/, "");
const N = Math.min(40, Number(n0 || 40));   // 番号は 4601〜4640 なので最大40件
// 箕輪小版：固定5か所＋「その他」（その他は綱島・日吉周辺のばらばらの座標）に順に割り振る
const PLACES = [
  { id: "apita",        lat: 35.54195,    lon: 139.641434 },
  { id: "shintsunashima", lat: 35.536551, lon: 139.636642 },
  { id: "conforte",     lat: 35.546082,   lon: 139.634018 },
  { id: "hiyoshinooka", lat: 35.548008,   lon: 139.642441 },
  { id: "pump",         lat: 35.53960528, lon: 139.65348008 },
  { id: "other",        lat: 35.5450,     lon: 139.6450 }
];
const placeOf = i => { const p = PLACES[i % PLACES.length]; return p.id === "other" ? { ...p, lat: +(p.lat + (i % 7) * 0.001).toFixed(6), lon: +(p.lon - (i % 5) * 0.001).toFixed(6) } : p; };
const SECRET = process.env.SUBMIT_SECRET || "minowa-ws-2026";

// 約200KB のダミー画像（JPEG の先頭・末尾つき。中身はランダム）
function dummyJpegDataURL(i) {
  const size = 200 * 1024;
  const b = Buffer.alloc(size);
  for (let k = 0; k < size; k++) b[k] = (k * 31 + i * 17) & 0xff;
  b[0] = 0xff; b[1] = 0xd8; b[size - 2] = 0xff; b[size - 1] = 0xd9;
  return "data:image/jpeg;base64," + b.toString("base64");
}

async function getArtworks() {
  const r = await fetch(BASE + "/artworks", { cache: "no-store" });
  if (!r.ok) throw new Error("GET /artworks " + r.status);
  return (await r.json()).features;
}

const before = await getArtworks();
console.log(`登録前の作品数: ${before.length}`);

const tag = "負荷テスト-" + Date.now();
const t0 = Date.now();
const results = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const payload = {
    secret: SECRET,
    lat: placeOf(i).lat,
    lon: placeOf(i).lon,
    properties: {
      field_23: ["事前", "災害時", "復旧時"][i % 3],
      field_24: null,
      field_25: String(4601 + i),
      Message: `${tag} #${i + 1} 大雨のときは早めに高いところへ！`,
      Body: "大雨で川があふれそうなときは、家族といっしょに早めに高い場所へ避難してほしいです。",
      place: placeOf(i).id,
      creationDate: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
    },
    imageBase64: dummyJpegDataURL(i),
    imageExt: "jpg"
  };
  const s = Date.now();
  try {
    const r = await fetch(BASE + "/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => null);
    return { i, ok: r.ok && j && j.ok, id: j && j.id, status: r.status, error: j && j.error, ms: Date.now() - s };
  } catch (e) {
    return { i, ok: false, error: String(e), ms: Date.now() - s };
  }
}));
const elapsed = Date.now() - t0;

const ok = results.filter(r => r.ok);
const ng = results.filter(r => !r.ok);
const ms = results.map(r => r.ms).sort((a, b) => a - b);
console.log(`送信: ${N}件 同時 → 成功 ${ok.length}件 / 失敗 ${ng.length}件（全体 ${elapsed}ms、1件あたり 中央値 ${ms[Math.floor(ms.length / 2)]}ms・最大 ${ms[ms.length - 1]}ms）`);
ng.forEach(r => console.log(`  失敗 #${r.i + 1}: status=${r.status} ${r.error}`));

const ids = new Set(ok.map(r => r.id));
console.log(`id の重複: ${ids.size === ok.length ? "なし" : "あり！"}`);

const after = await getArtworks();
const mine = after.filter(f => String(f.properties.Message || "").startsWith(tag));
console.log(`登録直後の GET /artworks: 全 ${after.length}件、今回の作品 ${mine.length}/${N}件 が表示`);
const imgCheck = await fetch(BASE + "/" + mine[0]?.properties.images[0]);
console.log(`画像の取得: ${imgCheck.status} ${imgCheck.headers.get("content-type")}`);
const textOk = mine.every(f => f.properties.Body === "大雨で川があふれそうなときは、家族といっしょに早めに高い場所へ避難してほしいです。");
const byPlace = PLACES.map(p => p.id + " " + mine.filter(f => f.properties.place === p.id).length + "件").join("・");
console.log(`場所ごと: ${byPlace}`);
const numsOk = new Set(mine.map(f => f.properties.field_25)).size === N;
console.log(`番号: ${numsOk ? "全部ちがう番号で保存" : "おかしい！"}`);
console.log(`日本語の文章: ${textOk ? "正しく保存" : "おかしい！"}`);

if (!KEEP) {
  let del = 0;
  for (const r of ok) {
    const d = await fetch(BASE + "/artworks/" + r.id, { method: "DELETE", headers: { Authorization: "Bearer " + adminKey } });
    if (d.ok) del++;
  }
  const last = await getArtworks();
  console.log(`テスト作品の削除: ${del}/${ok.length}件、削除後の作品数 ${last.length}（登録前 ${before.length}）`);
}

const pass = ok.length === N && mine.length === N && ids.size === N && textOk && numsOk;
console.log(pass ? "\n結果: OK（全件登録・直後に表示）" : "\n結果: NG");
process.exit(pass ? 0 : 1);
