// 防災行動マップの「使い方」の写真を、実際の画面から作る（workshop/present/guide_0N.jpg・detail_guide_0N.jpg）
//
// 使い方（授業で作品が登録されたあと、または先生が見本の作品をアプリで登録したあと）：
//   1) node tools/serve.mjs 5500
//   2) node tools/make_guide_images.mjs [WorkerのURL] [写す作品のid（カンマ区切り。省略すると全部）]
//      WorkerのURL を省略すると、本番の箕輪小版 Worker（minowa-submit）から作品を読む（読むだけ。登録・削除はしない）
//
// 箕輪小版の作品だけを使う（ほかのアプリ・ほかの学校のデータは使わない）。
// 固定の地点のうち作品がいちばん多い場所を、一覧（③）と作品ページ（「次の作品」）の写真に使う。
// 撮るときに、説明したいところをオレンジの枠と番号で目立たせる。
import { chromium } from "playwright";
import path from "node:path";

const WORKER = (process.argv[2] || "https://minowa-submit.kazuki131214.workers.dev").replace(/\/+$/, "");
const PICK = (process.argv[3] || "").split(",").map(s => s.trim()).filter(Boolean);
const APP = "http://localhost:5500";
const OUT = path.resolve("workshop/present");

const all = await fetch(WORKER + "/artworks").then(r => r.json());
const works = all.features.filter(f => !PICK.length || PICK.includes(String(f.properties.id)));
const ids = works.map(f => String(f.properties.id));
const count = {};
works.forEach(f => { const p = f.properties.place; if (p && p !== "other") count[p] = (count[p] || 0) + 1; });
const mainPlace = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
if (!mainPlace || count[mainPlace] < 2) {
  console.error("固定の地点に2作品以上ある場所が必要です（「次の作品」ボタンを写すため）。作品を登録してから実行してください。");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, locale: "ja-JP" });
const page = await ctx.newPage();
await page.goto(`${APP}/workshop/start/index.html?worker=${encodeURIComponent(WORKER.startsWith("http://127.0.0.1") ? WORKER : "default")}`);

try {
// 撮影中は見本の作品だけを見せる（手元で試した作品が写らないように）
await page.route(WORKER + "/artworks", async route => {
  const res = await route.fetch();
  const j = await res.json();
  j.features = j.features.filter(f => ids.includes(String(f.properties.id)));
  await route.fulfill({ response: res, json: j });
});
page.on("console", m => { if (m.type() === "error") console.log("  [console]", m.text()); });
page.on("pageerror", e => console.log("  [pageerror]", e.message));
page.on("dialog", d => { console.log("  [dialog]", d.message()); d.dismiss(); });
// 目立たせる枠（番号つき）を画面に重ねる
async function mark(selectors, opts = {}) {
  await page.evaluate(({ selectors, opts }) => {
    document.querySelectorAll(".guide-mark").forEach(e => e.remove());
    const els = [];
    selectors.forEach(sel => { (opts.all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)]).forEach(e => { if (e) els.push(e); }); });
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const pad = opts.pad == null ? 6 : opts.pad;
      const box = document.createElement("div");
      box.className = "guide-mark";
      box.style.cssText = `position:fixed;z-index:99999;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;border:5px solid #f97316;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,${opts.dim == null ? .35 : opts.dim});pointer-events:none;`;
      document.body.appendChild(box);
      if (opts.finger) {
        const f = document.createElement("div");
        f.className = "guide-mark";
        f.textContent = "👆";
        f.style.cssText = `position:fixed;z-index:100000;left:${r.left + r.width * .55}px;top:${r.top + r.height * .45}px;font-size:64px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));pointer-events:none;`;
        document.body.appendChild(f);
      }
    });
    // 1つ目以外の枠の暗い影は重ならないように消す
    document.querySelectorAll(".guide-mark").forEach((e, i) => { if (i > 0 && e.textContent !== "👆") e.style.boxShadow = "none"; });
  }, { selectors, opts });
  await page.waitForTimeout(200);
}

await page.goto(`${APP}/workshop/present/index.html`);
await page.evaluate(() => { localStorage.setItem("minowa_has_seen_map_tutorial_rev3", "true"); });
await page.goto(`${APP}/workshop/present/index.html`);
await page.waitForSelector(".art-card", { timeout: 15000 });
await page.waitForTimeout(2500);

// 1：地図のピン（場所の名前と作品の数）
await mark([".place-pin .pp-box"], { pad: 6, dim: 0, all: true });
await page.screenshot({ path: path.join(OUT, "guide_01.jpg"), type: "jpeg", quality: 82 });

// 2：場所のボタンと、番号・タイトルで探す
await mark(["#sidebar-places"], { pad: 4 });
await page.screenshot({ path: path.join(OUT, "guide_02.jpg"), type: "jpeg", quality: 82 });

// 3：左の一覧の作品をタップ
await page.click('.place-tab[data-place="' + mainPlace + '"]');
await page.waitForTimeout(1500);
await mark(["#art-list-container .art-card"], { pad: 4, finger: true });
await page.screenshot({ path: path.join(OUT, "guide_03.jpg"), type: "jpeg", quality: 82 });

// 4：作品のページ
await page.evaluate(() => document.querySelectorAll(".guide-mark").forEach(e => e.remove()));
await page.evaluate(() => { localStorage.setItem("minowa_has_seen_detail_tutorial_rev3", "true"); });
await page.click("#art-list-container .art-card");
await page.waitForURL(/detail\.html/);
await page.waitForFunction(() => document.getElementById("art-title").textContent.length > 3, null, { timeout: 15000 });
await page.waitForTimeout(2000);
// 作品ページの小さな地図のタイルが読み込まれるまで待つ（通信が遅いと灰色のまま写るため）
await page.waitForFunction(() => { const t = [...document.querySelectorAll("#surrounding-map .leaflet-tile")]; return t.length > 0 && t.every(i => i.complete && i.naturalWidth > 0); }, null, { timeout: 30000 }).catch(() => console.log("  （地図のタイルの読み込みを待ちきれませんでした）"));
await mark([".dv-info"], { pad: 2, dim: .15 });
await page.screenshot({ path: path.join(OUT, "guide_04.jpg"), type: "jpeg", quality: 82 });

// ---- 作品ページの使い方の写真（detail_guide_01〜03.jpg） ----
// 1：作品（マーブリングとコラージュ）
await mark([".dv-art-frame"], { pad: 4, dim: .3 });
await page.screenshot({ path: path.join(OUT, "detail_guide_01.jpg"), type: "jpeg", quality: 82 });
// 2：タイトル・伝えたいこと・作品の情報
await mark([".dv-card-title", ".dv-card-body", ".dv-card-facts"], { pad: 3, dim: 0, all: true });
await page.screenshot({ path: path.join(OUT, "detail_guide_02.jpg"), type: "jpeg", quality: 82 });
// 3：「ハザードマップを重ねる」を押したところと、「次の作品」ボタン
await page.evaluate(() => document.querySelectorAll(".guide-mark").forEach(e => e.remove()));
await page.click("#hz-chips .dv-hz-chip");
await page.waitForTimeout(2500);
await mark(["#hz-chips .dv-hz-chip", "#next-btn"], { pad: 5, dim: 0, all: true });
await page.screenshot({ path: path.join(OUT, "detail_guide_03.jpg"), type: "jpeg", quality: 82 });

} finally {
await browser.close();
}
console.log(`使い方の画像を作りました（guide_01〜04.jpg・detail_guide_01〜03.jpg）（写した作品 ${ids.length} 件）。`);
