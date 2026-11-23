// 最初の画面 → 登録 → 防災行動マップ表示 までの通しテスト＋全画面のスクリーンショット
//
// 使い方:
//   1) node tools/serve.mjs 5500                 （アプリを http://127.0.0.1:5500 で配信）
//   2) Worker を用意する
//        ローカル：cd worker && npx wrangler dev --local --port 8787
//        本番   ：デプロイ済みの URL
//   3) node tools/e2e_flow.mjs <WorkerのURL> <ADMIN_KEY> [--app http://127.0.0.1:5500]
//
// 授業案 rev3 の流れ（S0→S1→S2→ここまで→（タブを閉じて）つづきから→S3→S5→S7→S8→登録→S9）を
// iPad の画面サイズ（横 1180×820、縦 820×1180）で1回ずつ通しで動かし、
// tools/out/screens/ に全画面のスクリーンショットを保存する。
// あわせて、各画面で「ルビのない漢字」「横にはみ出し」をチェックし、tools/out/report.json に書く。
// あわせて「同じ場所に10件登録してマップから全部開けるか」も確かめる。
// テストで登録した作品は最後に DELETE で消し、消えたことを確かめる。

import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// BROWSER=webkit で Safari と同じエンジンで動かす（iPad の Safari の確認用）。
//   ふつうは毎回まっさらな状態（Safari のプライベートモードと同じく、IndexedDB に Blob を保存できない）。
//   PERSIST=1 をつけると、データを残すふつうのブラウザとして動かす。
const ENGINE = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
const PERSIST = process.env.PERSIST === "1";
// 画面の移動を待つ：WebKit は地図のタイルの読み込みが終わるまで load が来ないことがあるので、DOM ができたら進む
const NAV = { waitUntil: "domcontentloaded" };

const args = process.argv.slice(2);
const WORKER = (args[0] || "http://127.0.0.1:8787").replace(/\/+$/, "");
const ADMIN_KEY = args[1] || "local-admin-key-for-test";
const APP = (args.includes("--app") ? args[args.indexOf("--app") + 1] : "http://127.0.0.1:5500").replace(/\/+$/, "");
const OUT = path.resolve("tools/out/screens");
fs.mkdirSync(OUT, { recursive: true });

const report = { worker: WORKER, app: APP, engine: ENGINE + (PERSIST ? "（データを残す）" : "（まっさら）"), runs: [] };
console.log("ブラウザ:", report.engine);

// ルビのない漢字・横のはみ出しを調べる（各フレームで実行）
const CHECK = () => {
  const KANJI = /[々一-鿿]/;
  const bad = new Set();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const t = n.nodeValue;
    if (!KANJI.test(t)) continue;
    let el = n.parentElement, skip = false;
    while (el) {
      const tag = el.tagName;
      if (tag === "RUBY" || tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "TITLE") { skip = true; break; }
      // 見えていないもの・出典・凡例のマーク・図の中の文字・作品データ（児童の書いた文章・地名）は対象外
      if (el.classList && (el.classList.contains("leaflet-control-attribution") || el.hasAttribute("data-user-text") || el.classList.contains("summary-value") || el.classList.contains("art-message") || el.classList.contains("art-title") || el.classList.contains("res-source") || el.classList.contains("attr") || el.classList.contains("res-badge") || el.classList.contains("rb-seen") || el.classList.contains("no-ruby") || el.classList.contains("ribbon-text") || tag === "svg" || tag === "text")) { skip = true; break; }
      el = el.parentElement;
    }
    if (skip) continue;
    const pe = n.parentElement;
    const st = pe && getComputedStyle(pe);
    if (!pe || st.display === "none" || st.visibility === "hidden" || pe.offsetParent === null && st.position !== "fixed") continue;
    bad.add(t.trim().slice(0, 40));
  }
  const de = document.documentElement;
  return { noRuby: [...bad], hOverflow: de.scrollWidth - de.clientWidth };
};

async function check(page, name, run) {
  const res = { name, frames: [] };
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(CHECK);
      res.frames.push({ url: f.url().replace(APP, ""), ...r });
    } catch (e) { /* 読み込み中のフレーム */ }
  }
  run.pages.push(res);
}

async function shot(page, run, name) {
  const file = `${run.label}_${String(run.n++).padStart(2, "0")}_${name}.png`;
  await page.waitForTimeout(600);
  // 起動直後などに撮影がまれに失敗するので、3回まで撮り直す
  for (let i = 0; ; i++) {
    try { await page.screenshot({ path: path.join(OUT, file) }); break; }
    catch (e) { if (i >= 2) throw e; await page.waitForTimeout(1000); }
  }
  await check(page, name, run);
  run.shots.push(file);
}

async function flow(label, viewport, placeId, number) {
  const run = { label, viewport, n: 1, shots: [], pages: [], steps: [], errors: [], checks: {}, yagamiRequests: [], workerHosts: new Set() };
  report.runs.push(run);
  const step = (s) => { run.steps.push(s); console.log(`[${label}] ${s}`); };

  const opts = { viewport, deviceScaleFactor: 2, acceptDownloads: true, locale: "ja-JP" };
  if (ENGINE === "webkit") Object.assign(opts, { userAgent: devices["iPad Pro 11"].userAgent, hasTouch: true });
  let browser, ctx;
  if (PERSIST) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-e2e-"));
    ctx = await (ENGINE === "webkit" ? webkit : chromium).launchPersistentContext(dir, ENGINE === "webkit" ? opts : { ...opts, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
    browser = { close: () => ctx.close() };
  } else {
    browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
    ctx = await browser.newContext(opts);
  }
  let page = await ctx.newPage();
  const watch = (p) => {
    p.on("pageerror", e => run.errors.push(`${p.url().replace(APP, "")}: ${e.message}`));
    p.on("dialog", d => d.accept());
    // 矢上小版の Worker・画像に1回もアクセスしないこと（読み込みも書き込みも）
    p.on("request", r => { const u = r.url(); if (/yagami/i.test(u)) run.yagamiRequests.push(r.method() + " " + u); { const h = new URL(u).host; if (/.workers.dev$|^127.0.0.1:8787$/.test(h)) run.workerHosts.add(h); } });
  };
  watch(page);

  // S0 はじめる（データがないので「はじめる」だけが出る）
  await page.goto(`${APP}/workshop/start/index.html?worker=${encodeURIComponent(WORKER)}`);
  await page.waitForSelector("#startBtn", { state: "visible" });
  await shot(page, run, "S0_start");
  await page.click("#startBtn");

  // S1 場所（6つのボタン：固定5か所＋その他）
  await page.waitForURL(/workshop\/map\/Log\/log_hazard_map/, NAV);
  await page.waitForTimeout(800);
  run.checks.s1Buttons = await page.locator(".place-btn").count();
  run.checks.s1Markers = await page.locator(".place-marker").count();
  run.checks.s1Stepper = (await page.locator(".step-indicator").innerText()).replace(/\s+/g, "");
  await shot(page, run, "S1_place_empty");
  await page.click(`.place-btn[data-place="${placeId}"]`);
  await page.waitForTimeout(800);
  if (placeId === "other") {
    // 「つぎへ」はピンを置くまで押せない
    run.checks.otherNextBlocked = await page.locator("#nextBtn").isDisabled();
    // 枠の外をタップ → 置けない（注意が出る）
    await page.evaluate(() => state.map.fire("click", { latlng: L.latLng(35.60, 139.70) }));
    await page.waitForTimeout(300);
    run.checks.outOfAreaBlocked = (await page.locator("#mapToast").isVisible()) && !(await page.locator("#pinConfirm").isVisible());
    await shot(page, run, "S1_other_outside");
    // 地図のまん中（枠の中）をタップ → 「ここでいいかな？」
    const mb = await page.locator("#map").boundingBox();
    await page.mouse.click(mb.x + mb.width * 0.55, mb.y + mb.height * 0.5);
    await page.waitForSelector("#pinConfirm", { state: "visible", timeout: 5000 });
    await page.waitForTimeout(1200);
    run.checks.confirmTitle = (await page.locator("#pinConfirmTitle").innerText()).trim();
    await shot(page, run, "S1_other_confirm");
    // 「置き直す」→ もう一度タップ →「ここにする」
    await page.click("#pinRetryBtn");
    await page.mouse.click(mb.x + mb.width * 0.45, mb.y + mb.height * 0.45);
    await page.waitForSelector("#pinConfirm", { state: "visible", timeout: 5000 });
    await page.waitForTimeout(800);
    await page.click("#pinOkBtn");
    await page.waitForTimeout(800);
    run.pin = await page.evaluate(() => JSON.parse(localStorage.getItem("minowa_hazardMapLog") || "{}").location);
    run.checks.otherPinShown = await page.locator("#map .other-pin").count();
  } else {
    run.pin = await page.evaluate(() => JSON.parse(localStorage.getItem("minowa_hazardMapLog") || "{}").location);
  }
  await shot(page, run, "S1_place");
  step(`S1 場所：ボタン ${run.checks.s1Buttons} 個・地図の目印 ${run.checks.s1Markers} 個から ${placeId} を選択 → ${JSON.stringify(run.pin)}` +
    (placeId === "other" ? `（ピン前は進めない=${run.checks.otherNextBlocked}、枠の外は置けない=${run.checks.outOfAreaBlocked}、確認「${run.checks.confirmTitle}」）` : ""));
  await page.click("#nextBtn");

  // 休み時間：タブを閉じて開き直す → 「つづきから」（「1コマ目はここまで」の画面はなくした）
  await page.waitForURL(/workshop\/marbling\/app\//, NAV);
  await page.waitForTimeout(1000);
  await page.close();
  page = await ctx.newPage();
  watch(page);
  await page.goto(`${APP}/workshop/start/index.html`);
  await page.waitForSelector("#resumeBtn", { state: "visible" });
  run.checks.resumeWhere = (await page.locator("#resumeWhere").innerText()).replace(/\s+/g, "");
  await shot(page, run, "S0b_resume");
  await page.click("#resumeBtn");
  await page.waitForURL(/workshop\/marbling\/app\//, NAV);
  const savedPlace = await page.evaluate(() => (JSON.parse(localStorage.getItem("minowa_hazardMapLog") || "{}").location || {}).place);
  run.checks.resumeOK = savedPlace === placeId;
  run.checks.marblingStepper = await page.evaluate(() => [...document.querySelectorAll(".ws-stepper__label")].map(e => { const c = e.cloneNode(true); c.querySelectorAll("rt").forEach(x => x.remove()); return c.textContent; }).join("/"));
  run.checks.marblingMapBtn = await page.locator("#mapBtn").count();
  step(`つづきから：タブを閉じて開き直し → マーブリングから再開（${run.checks.resumeWhere}）、場所 ${savedPlace}、ステップ表示 ${run.checks.marblingStepper}`);

  // S3 マーブリング
  await page.waitForTimeout(1500);
  async function paint(color) {
    const c = await page.frameLocator("iframe[data-ws-work]").locator("canvas").boundingBox();
    const sw = page.frameLocator("iframe[data-ws-work]").locator("#swatches button, #swatches .swatch").nth(color);
    if (await sw.count()) await sw.click();
    await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.4);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) await page.mouse.move(c.x + c.width * (0.3 + i * 0.02), c.y + c.height * (0.4 + Math.sin(i / 3) * 0.15));
    await page.mouse.up();
    await page.waitForTimeout(800);
  }
  await paint(0);
  await paint(3);
  await shot(page, run, "S3_marbling");
  step("S3 マーブリング：2色で描画");
  await page.click("#nextBtn");

  // S5 コラージュ（スタンプを2つ置く）
  await page.waitForURL(/workshop\/collage\/app\//, NAV);
  const cfr = () => page.frames().find(f => f.url().includes("collage/app/detail"));
  await page.waitForTimeout(1500);
  const cl = page.frameLocator("iframe[data-ws-work]");
  const stage = await cl.locator("#stage").boundingBox();
  await cl.locator(".thumb").nth(4).click();
  await page.mouse.click(stage.x + stage.width * 0.35, stage.y + stage.height * 0.5);
  await cl.locator(".thumb").nth(11).click();
  await cl.locator(".swatch").nth(2).click();
  await page.mouse.click(stage.x + stage.width * 0.65, stage.y + stage.height * 0.4);
  await page.waitForTimeout(800);
  // 濃さのレバー：いちばん右（こく）にすると、選んでいるスタンプが濃くなる
  run.checks.alpha = await cfr().evaluate(() => {
    const el = document.getElementById("alpha");
    if (!el) return { slider: false };
    const i = stamps.length - 1;
    selectIndex(i);
    const before = stamps[i].alpha;
    el.value = "1"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    const after = stamps[i].alpha;
    el.value = "0.3"; el.dispatchEvent(new Event("input", { bubbles: true }));
    const light = stamps[i].alpha;
    el.value = "1"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    return { slider: true, before, after, light };
  });
  await page.waitForTimeout(800);
  await shot(page, run, "S5_collage");
  const stampsBefore = await cfr().evaluate(() => stamps.length);
  step(`S5 コラージュ：スタンプ ${stampsBefore} 個、濃さのレバー ${JSON.stringify(run.checks.alpha)}`);

  // マーブリングに戻って描き足す（スタンプが消えないこと）
  await page.click("#backBtn");
  await page.waitForURL(/workshop\/marbling\/app\//, NAV);
  await page.waitForTimeout(2000);
  await paint(5);
  await page.click("#nextBtn");
  await page.waitForURL(/workshop\/collage\/app\//, NAV);
  // 保存したスタンプの読み込みが終わるまで待つ（WebKit は時間がかかることがある）
  await page.waitForFunction(() => { const f = document.querySelector("iframe[data-ws-work]"); try { return f && f.contentWindow && f.contentWindow.WS_isReady; } catch (e) { return false; } }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const stampsAfter = await cfr().evaluate(() => stamps.length);
  run.checks.alphaKept = await cfr().evaluate(() => stamps.length ? Math.round(stamps[stamps.length - 1].alpha * 100) / 100 : null);
  run.restore = { stampsBefore, stampsAfter };
  step(`マーブリングに戻って描き足し → コラージュ：スタンプ ${stampsAfter} 個（前は ${stampsBefore} 個）`);
  await page.click("#nextBtn");

  // S7 タイトル・伝えたいこと・いつの行動か・ペンネーム
  await page.waitForURL(/workshop\/message\/artwork\//, NAV);
  await page.fill("#artworkTitle", `E2Eテスト（${label}）大雨のときは早めに高いところへ！`);
  await page.fill("#artworkBody", "大雨で川があふれそうなときは、家族といっしょに早めに高い場所へ避難してほしいです。");
  await page.locator(".phase-option").nth(1).click();
  await page.fill("#creatorNumber", "   ");
  const blankBlocked = await page.locator("#nextBtn").isDisabled();
  await page.fill("#creatorNumber", "あいうえおかきくけこさしすせそ");   // 15文字（文字数の決まりはないので進める）
  run.checks.badNumberBlocked = blankBlocked && !(await page.locator("#nextBtn").isDisabled());
  await page.fill("#creatorNumber", "  " + number + "  ");   // 前後の空白はとって保存する
  run.checks.numberInputmode = await page.getAttribute("#creatorNumber", "inputmode");
  await shot(page, run, "S7_message");
  step(`S7 入力：空白だけでは進めない・15文字は進める=${run.checks.badNumberBlocked}、ペンネーム「${number}」`);
  await page.click("#nextBtn");

  // S8 確認して登録（スクロールなしで「登録する」が見える）
  await page.waitForURL(/workshop\/message\/lastconfirm\//, NAV);
  await page.waitForSelector("#artwork-preview-img", { state: "visible", timeout: 10000 });
  run.checks.s8 = await page.evaluate(() => {
    const de = document.documentElement, b = document.getElementById("btn-submit-artwork").getBoundingClientRect();
    return { scroll: de.scrollHeight - innerHeight, submitVisible: b.bottom <= innerHeight && b.top >= 0, rows: document.querySelectorAll(".s8-row").length, empty: document.querySelectorAll(".s8-row.empty").length };
  });
  const imgInfo = await page.evaluate(async () => {
    const d = localStorage.getItem("minowa_artworkImage");
    const img = new Image(); img.src = d; await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight, kb: Math.round(d.length * 0.75 / 1024) };
  });
  run.artworkImage = imgInfo;
  await shot(page, run, "S8_confirm");
  step(`S8 確認：項目 ${run.checks.s8.rows}（未入力 ${run.checks.s8.empty}）、スクロール ${run.checks.s8.scroll}px、登録ボタンが見える=${run.checks.s8.submitVisible}、画像 ${imgInfo.w}×${imgInfo.h}`);

  // 「直す」→ S7（修正中）→「修正完了」で確認画面にもどる
  await page.locator(".s8-edit").first().click();
  await page.waitForURL(/workshop\/message\/artwork\/artwork_submit\.html\?edit=1/, NAV);
  run.checks.editLabel = (await page.locator("#nextBtn").innerText()).replace(/\s+/g, "");
  await page.fill("#artworkTitle", `E2Eテスト（${label}）警報が出たら早めに高い場所へ`);
  await page.click("#nextBtn");
  await page.waitForURL(/workshop\/message\/lastconfirm\//, NAV);
  run.checks.editBack = (await page.locator(".s8-v-title").innerText()).includes("警報が出たら");
  step(`直す：ボタン「${run.checks.editLabel}」で確認画面にもどった、タイトルが変わった=${run.checks.editBack}`);

  // 作り直し（マーブリング・コラージュ）
  const artNow = () => page.evaluate(() => localStorage.getItem("minowa_artworkImage") || "");
  const stampCount = () => page.evaluate(() => new Promise(res => {
    const r = indexedDB.open("minowa_ws_art_db", 1);
    r.onsuccess = () => { const g = r.result.transaction("images").objectStore("images").get("collage_stamps"); g.onsuccess = () => res(((g.result || {}).stamps || []).length); };
  }));
  await page.waitForSelector("#artwork-preview-img", { state: "visible", timeout: 10000 });
  const art0 = await artNow();
  await page.click(`[onclick="redoWork('marblingApp')"]`);
  await page.waitForURL(/workshop\/marbling\/app\/index\.html\?edit=1/, NAV);
  await page.waitForTimeout(2000);
  const editUI = await page.evaluate(() => ({ next: (document.getElementById("nextBtn") || {}).textContent || "", back: !!document.getElementById("backBtn"), badge: !!document.querySelector(".ws-edit-badge") }));
  await shot(page, run, "S8c_redo_marbling");
  await paint(1);
  await page.click("#nextBtn");
  await page.waitForURL(/workshop\/message\/lastconfirm\//, { ...NAV, timeout: 20000 });
  await page.waitForSelector("#artwork-preview-img", { state: "visible", timeout: 10000 });
  const art1 = await artNow();
  const stamps1 = await stampCount();
  step(`作り直し（マーブリング）：確認画面にもどった・作品画像 ${art1 !== art0 ? "更新" : "そのまま"}・スタンプ ${stamps1} 個`);
  await page.click(`[onclick="redoWork('collageApp')"]`);
  await page.waitForURL(/workshop\/collage\/app\/index\.html\?edit=1/, NAV);
  await page.waitForTimeout(2000);
  const st2 = await page.frameLocator("iframe[data-ws-work]").locator("#stage").boundingBox();
  await page.frameLocator("iframe[data-ws-work]").locator(".thumb").nth(0).click();
  await page.mouse.click(st2.x + st2.width * 0.5, st2.y + st2.height * 0.7);
  await page.waitForTimeout(800);
  await page.click("#nextBtn");
  await page.waitForURL(/workshop\/message\/lastconfirm\//, { ...NAV, timeout: 20000 });
  await page.waitForSelector("#artwork-preview-img", { state: "visible", timeout: 10000 });
  const art2 = await artNow();
  const stamps2 = await stampCount();
  run.redo = { editUI, marblingUpdated: art1 !== art0, stampsAfterMarblingRedo: stamps1, collageUpdated: art2 !== art1, stampsAfterCollageRedo: stamps2 };
  step(`作り直し（コラージュ）：確認画面にもどった・作品画像 ${art2 !== art1 ? "更新" : "そのまま"}・スタンプ ${stamps2} 個`);

  // 登録
  // 登録すると、作品がこの端末に自動で保存される（保存ボタンはない）
  let downloads = 0;
  page.on("download", () => { downloads++; });
  // 矢上 e0b3c59：登録しても、作品をこの端末にダウンロードしない（保存ボタンも、保存のメッセージも出ない）
  await page.click("#btn-submit-artwork");
  await page.waitForSelector("#step-complete", { state: "visible", timeout: 20000 });
  const id = await page.evaluate(() => localStorage.getItem("minowa_lastSubmittedArtworkId"));
  run.submittedId = id;
  run.checks.saveButton = await page.locator("#btn-download").count();
  run.checks.saveNote = await page.locator("#download-note").count() + await page.getByText("端末に保存").count();
  await shot(page, run, "S8b_done");
  step(`S8 登録：id=${id}、ダウンロード ${downloads} 回、保存ボタン ${run.checks.saveButton} 個、保存のメッセージ ${run.checks.saveNote} 個`);
  // 画面を開き直しても、もう一度は保存しない（二重に保存しない）
  await page.reload();
  await page.waitForSelector("#step-complete", { state: "visible", timeout: 10000 });
  await page.waitForTimeout(1500);
  run.checks.downloads = downloads;
  step(`開き直したあとのダウンロードの回数：${downloads} 回（0回ならよい）`);
  const saved = await fetch(`${WORKER}/artworks`).then(r => r.json());
  const mine = saved.features.find(f => f.properties.id === id);
  run.checks.savedFields = mine && { place: mine.properties.place, number: mine.properties.field_25, phase: mine.properties.field_23, body: !!mine.properties.Body, field_24: mine.properties.field_24, lat: mine.geometry.coordinates[1], lon: mine.geometry.coordinates[0], image: (mine.properties.images || [])[0] };
  run.checks.savedLatLonOK = !!mine && Math.abs(mine.geometry.coordinates[1] - run.pin.lat) < 1e-6 && Math.abs(mine.geometry.coordinates[0] - run.pin.lon) < 1e-6;
  run.checks.imageServed = !!(mine && mine.properties.images[0]) && (await fetch(`${WORKER}/${mine.properties.images[0]}`)).status === 200;
  step(`保存された値：${JSON.stringify(run.checks.savedFields)}`);

  // S9 防災行動マップ（自分の場所が開く）
  await page.click("#btn-goto-map");
  await page.waitForURL(/workshop\/present\/index/, NAV);
  // はじめて開いたので、マップの使い方（写真つき4枚）が自動で出る
  await page.waitForSelector("#tutorial-overlay", { state: "visible", timeout: 10000 });
  run.checks.guide = [];
  run.checks.guideButtons = await page.locator("#tutorial-overlay .tutorial-footer button").count();
  for (let g = 0; g < 4; g++) {
    await page.waitForTimeout(500);
    run.checks.guide.push(await page.evaluate(() => { const i = document.getElementById("tutorial-img"); return i.complete && i.naturalWidth > 0; }));
    await shot(page, run, `S9a_guide${g + 1}`);
    await page.click("#next-btn");
  }
  run.checks.guideClosed = !(await page.locator("#tutorial-overlay").isVisible());
  step(`マップの使い方：自動で表示、写真 ${run.checks.guide.filter(Boolean).length}/4 枚、最後に閉じた=${run.checks.guideClosed}`);
  await page.waitForSelector(`#card-${id}`, { timeout: 15000 });
  await page.waitForTimeout(1200);
  run.checks.mapPlaceActive = await page.locator(`.place-tab.active[data-place="${placeId}"]`).count() === 1;
  run.checks.placePins = await page.locator(".place-pin").count();
  run.checks.placeTabs = await page.locator(".place-tab").count();
  run.checks.otherWorkPins = await page.locator(".other-work-pin").count();
  run.checks.cardPlace = (await page.locator(`#card-${id} .art-place`).innerText()).replace(/\s+/g, "");
  await shot(page, run, "S9_present");
  step(`S9 マップ：作品 ${id} が ${placeId} の一覧に表示（場所の表示「${run.checks.cardPlace}」）、場所のピン ${run.checks.placePins} 個、その他のピン ${run.checks.otherWorkPins} 個、場所のボタン ${run.checks.placeTabs} 個`);
  await page.fill("#art-search", number);
  await page.waitForTimeout(400);
  run.checks.search = await page.evaluate(([id, num]) => { const cards = [...document.querySelectorAll(".art-card")]; return { count: cards.length, hasMine: cards.some(c => c.id === "card-" + id), allMatch: cards.every(c => (c.querySelector(".art-num") || {}).textContent === num) }; }, [id, number]);
  step(`ペンネームで探す：「${number}」→ ${run.checks.search.count} 件（自分の作品あり=${run.checks.search.hasMine}、全部同じペンネーム=${run.checks.search.allMatch}）`);
  await page.fill("#art-search", "");
  await page.click(`#card-${id}`);
  await page.waitForURL(/workshop\/present\/detail\.html/, NAV);
  await page.waitForTimeout(1500);
  await shot(page, run, "S9b_detail_tutorial");
  // 作品ページの使い方（3ページ）を「つぎへ」で最後まで進めて閉じる
  for (let k = 0; k < 4 && await page.locator("#detail-tutorial-overlay").isVisible(); k++) { await page.click("#dt-next-btn"); await page.waitForTimeout(300); }
  await page.waitForTimeout(800);
  run.checks.detail = {
    number: await page.locator("#art-number").innerText(),
    body: (await page.locator("#art-body").innerText()).length > 0,
    place: (await page.locator("#art-place").innerText()).replace(/\s+/g, ""),
    hazardRowHidden: !(await page.locator("#art-hazards").isVisible()),
    navVisible: await page.evaluate(() => getComputedStyle(document.getElementById("next-btn")).visibility !== "hidden"),
    hzChip: await page.locator(".dv-hz-chip").count()
  };
  await shot(page, run, "S9c_detail");
  if (run.checks.detail.hzChip) {
    await page.click(".dv-hz-chip");
    await page.waitForTimeout(2000);
    run.checks.detail.hzOn = await page.locator(".dv-hz-chip.on").count() === 1;
    await shot(page, run, "S9d_detail_hazard");
  }
  step(`作品ページ：ペンネーム ${run.checks.detail.number}、場所「${run.checks.detail.place}」、伝えたいこと ${run.checks.detail.body ? "あり" : "なし"}、災害の行を隠す=${run.checks.detail.hazardRowHidden}、次の作品ボタン=${run.checks.detail.navVisible ? "あり" : "なし"}、ハザードマップを重ねる=${run.checks.detail.hzOn}`);

  // テスト作品を削除
  const del = await fetch(`${WORKER}/artworks/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + ADMIN_KEY } }).then(r => r.json());
  const left = await fetch(`${WORKER}/artworks`).then(r => r.json());
  run.deleted = del.ok && !left.features.some(f => f.properties.id === id);
  step(`後片付け：DELETE /artworks/${id} → ${run.deleted ? "消えた" : "残っている！"}`);

  await browser.close();
  delete run.n;
  run.workerHosts = [...run.workerHosts];
}

// 同じ場所に10件登録して、マップから10件とも開けるか
async function samePlaceTen() {
  const t = { label: "same-place-10", ok: false, opened: 0, ids: [] };
  report.samePlace = t;
  const tag = "E2E同じ場所-" + Date.now();
  const img = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${WORKER}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      secret: "minowa-ws-2026", lat: 35.54195, lon: 139.641434, imageBase64: img, imageExt: "jpg",
      properties: { field_23: "事前", field_24: null, field_25: "同じ場所" + (i + 1), Message: `${tag} #${i + 1}`, Body: "テスト", place: "apita" } }) }).then(r => r.json());
    if (r.ok) t.ids.push(r.id);
  }
  const browser = await chromium.launch();
  try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: "ja-JP" })).newPage();
  // 手元の Worker を使うように覚えさせる（スタート画面の ?worker= と同じしくみ）
  await page.goto(`${APP}/workshop/start/index.html?worker=${encodeURIComponent(WORKER)}`);
  await page.evaluate(() => localStorage.setItem("minowa_has_seen_map_tutorial_rev3", "true"));
  await page.goto(`${APP}/workshop/present/index.html?place=apita`);
  await page.waitForSelector(`#card-${t.ids[0]}`, { timeout: 15000 });
  t.listed = await page.locator(".art-card").count();
  await page.screenshot({ path: path.join(OUT, "same_place_10_list.png") });
  for (const id of t.ids) {
    await page.goto(`${APP}/workshop/present/index.html?place=apita`);
    await page.waitForSelector(`#card-${id}`, { timeout: 15000 });
    await page.click(`#card-${id}`);
    await page.waitForURL(/workshop\/present\/detail\.html/, NAV);
    await page.waitForFunction(() => document.getElementById("art-title").textContent.length > 1, null, { timeout: 10000 });
    if ((await page.locator("#art-title").innerText()).startsWith(tag)) t.opened++;
  }
  } finally {
  await browser.close();
  for (const id of t.ids) await fetch(`${WORKER}/artworks/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + ADMIN_KEY } });
  }
  t.ok = t.ids.length === 10 && t.opened === 10;
  console.log(`[同じ場所に10件] 登録 ${t.ids.length} 件、一覧に ${t.listed} 件、マップから開けた作品 ${t.opened} 件 → ${t.ok ? "OK" : "NG"}（テスト作品は削除）`);
}

// 横向き：固定の地点（新綱島駅）、縦向き：「その他」（地図にピンを置く）
await flow("landscape", { width: 1180, height: 820 }, "shintsunashima", "E2Eぼうさい1");
await flow("portrait", { width: 820, height: 1180 }, "other", "E2E防災ヒーロー");
await samePlaceTen();

fs.writeFileSync(path.resolve("tools/out/report.json"), JSON.stringify(report, null, 2));
const problems = [];
if (!report.samePlace.ok) problems.push("同じ場所に10件：全部開けない");
for (const r of report.runs) {
  const c = r.checks;
  const other = r.label === "portrait";
  if (r.errors.length) problems.push(`[${r.label}] JSエラー: ${r.errors.join(" / ")}`);
  if (r.yagamiRequests.length) problems.push(`[${r.label}] 矢上小版へのアクセスがある: ${r.yagamiRequests.join(" / ")}`);
  if (r.workerHosts.some(h => !/^(minowa-submit\.kazuki131214\.workers\.dev|127\.0\.0\.1:8787)$/.test(h))) problems.push(`[${r.label}] 箕輪小版以外の Worker にアクセスした: ${r.workerHosts.join(", ")}`);
  if (!r.deleted) problems.push(`[${r.label}] 削除できていない`);
  if (c.s1Buttons !== 6 || c.s1Markers !== 5) problems.push(`[${r.label}] S1 のボタン（6つ）・地図の目印（5つ）の数がおかしい ${c.s1Buttons}/${c.s1Markers}`);
  if (!/^1場所/.test(c.s1Stepper)) problems.push(`[${r.label}] S1 のステップ表示がおかしい ${c.s1Stepper}`);
  if (c.marblingStepper !== "場所/マーブリング/コラージュ/メッセージ") problems.push(`[${r.label}] ステップ表示がおかしい ${c.marblingStepper}`);
  if (c.marblingMapBtn !== 0) problems.push(`[${r.label}] マーブリングに「ハザードマップ」ボタンが残っている`);
  if (other) {
    if (!c.otherNextBlocked) problems.push(`[${r.label}] その他：ピンを置く前に進めてしまう`);
    if (!c.outOfAreaBlocked) problems.push(`[${r.label}] その他：枠の外にピンを置けてしまう`);
    if (c.confirmTitle !== "ここでいいかな？") problems.push(`[${r.label}] その他：確認の画面が出ない（${c.confirmTitle}）`);
    if (!r.pin || r.pin.place !== "other" || !(r.pin.lat > 35.525 && r.pin.lat < 35.565)) problems.push(`[${r.label}] その他：ピンの位置が保存されない ${JSON.stringify(r.pin)}`);
    if (c.otherPinShown !== 1) problems.push(`[${r.label}] その他：地図にピンが出ない`);
  }
  if (!c.resumeOK) problems.push(`[${r.label}] つづきから再開できない`);
  if (r.restore.stampsAfter !== r.restore.stampsBefore) problems.push(`[${r.label}] スタンプが復元されない`);
  if (!c.alpha || !c.alpha.slider || c.alpha.after !== 1 || !(c.alpha.light < 0.4)) problems.push(`[${r.label}] 濃さのレバーが効かない ${JSON.stringify(c.alpha)}`);
  if (c.alphaKept !== 1) problems.push(`[${r.label}] 濃さが保存されない（もどったあと ${c.alphaKept}）`);
  if (!c.badNumberBlocked) problems.push(`[${r.label}] 空白だけで進めてしまう、または15文字で進めない`);
  if (c.numberInputmode === "numeric") problems.push(`[${r.label}] ペンネームなのに数字キーボードになる`);
  if (c.s8.scroll > 0 || !c.s8.submitVisible || c.s8.rows !== 5 || c.s8.empty) problems.push(`[${r.label}] S8 が1画面に収まらない／未入力あり ${JSON.stringify(c.s8)}`);
  if (!/修正/.test(c.editLabel) || !c.editBack) problems.push(`[${r.label}] 「直す」から確認画面にもどれない`);
  if (r.redo) {
    if (r.redo.editUI.back || !/修正/.test(r.redo.editUI.next) || !r.redo.editUI.badge) problems.push(`[${r.label}] 修正用の画面のボタンがおかしい ${JSON.stringify(r.redo.editUI)}`);
    if (!r.redo.marblingUpdated) problems.push(`[${r.label}] マーブリングを作り直しても作品画像が変わらない`);
    if (r.redo.stampsAfterMarblingRedo !== r.restore.stampsAfter) problems.push(`[${r.label}] マーブリングの作り直しでスタンプが変わった`);
    if (!r.redo.collageUpdated || r.redo.stampsAfterCollageRedo !== r.redo.stampsAfterMarblingRedo + 1) problems.push(`[${r.label}] コラージュの作り直しが反映されない`);
  }
  const sf = c.savedFields || {};
  if (!sf.body || !/^E2E/.test(sf.number || "") || sf.place !== (other ? "other" : "shintsunashima") || sf.phase !== "災害時") problems.push(`[${r.label}] 保存された値がおかしい ${JSON.stringify(sf)}`);
  if (!c.savedLatLonOK) problems.push(`[${r.label}] 保存された緯度経度が選んだ地点とちがう ${JSON.stringify(sf)} / ${JSON.stringify(r.pin)}`);
  if (!c.imageServed) problems.push(`[${r.label}] R2 の画像が読めない`);
  if (!c.guide || c.guide.filter(Boolean).length !== 4 || !c.guideClosed) problems.push(`[${r.label}] マップの使い方の写真が出ない／閉じない ${JSON.stringify(c.guide)}`);
  if (c.saveButton !== 0 || c.saveNote !== 0 || c.downloads !== 0) problems.push(`[${r.label}] 登録したときに端末に保存している（保存ボタン ${c.saveButton}、保存のメッセージ ${c.saveNote}、ダウンロード ${c.downloads} 回）`);
  if (c.guideButtons !== 1) problems.push(`[${r.label}] マップの使い方のボタンが ${c.guideButtons} 個（1つにする）`);
  if (!c.mapPlaceActive || c.placePins !== 5 || c.placeTabs !== 7) problems.push(`[${r.label}] マップで自分の場所が開かない／ピン5つ・ボタン7つでない（${c.placePins}/${c.placeTabs}）`);
  if (other && (c.otherWorkPins < 1 || !String(c.cardPlace).includes("その他"))) problems.push(`[${r.label}] その他の作品がマップに出ない／「その他」と出ない（${c.otherWorkPins}／${c.cardPlace}）`);
  if (!c.search.hasMine || !c.search.allMatch) problems.push(`[${r.label}] ペンネームで探す結果がおかしい ${JSON.stringify(c.search)}`);
  const d = c.detail || {};
  if (other ? (!String(d.place).includes("その他") || d.navVisible) : !String(d.place).includes("新綱島駅")) problems.push(`[${r.label}] 作品ページの場所・次の作品がおかしい ${JSON.stringify(d)}`);
  if (!d.hazardRowHidden || !d.hzOn) problems.push(`[${r.label}] 作品ページのハザードマップの表示がおかしい ${JSON.stringify(d)}`);
  for (const p of r.pages) for (const f of p.frames) {
    if (f.noRuby.length) problems.push(`[${r.label}] ${p.name} ${f.url}: ルビなし ${JSON.stringify(f.noRuby)}`);
    if (f.hOverflow > 0) problems.push(`[${r.label}] ${p.name} ${f.url}: 横にはみ出し ${f.hOverflow}px`);
  }
}
console.log(problems.length ? "\n要確認:\n" + problems.join("\n") : "\n問題なし");
