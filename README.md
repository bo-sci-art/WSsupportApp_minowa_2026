# WS支援アプリ 箕輪小版（箕輪小学校4年6組 授業用）

小学4年生向けの防災アート WS 支援アプリの箕輪小専用版です。
ほかの学校の版・大人向けのアプリ・それらの Worker／データベース／画像保存先とは一切つながっていません（ファイルだけを履歴なしでコピーして作りました）。

- 公開 URL（GitHub Pages）：https://bo-sci-art.github.io/WSsupportApp_minowa_2026/
- 防災行動マップ（保護者向けカードの QR の行き先）：https://bo-sci-art.github.io/WSsupportApp_minowa_2026/workshop/present/
- 作品の保存先：Cloudflare Worker `minowa-submit`（https://minowa-submit.kazuki131214.workers.dev ）
  - 文章・地点：D1 `minowa-artworks`、画像：R2 `minowa-artworks`
  - 準備・運用の手順は [docs/cloudflare_setup.md](docs/cloudflare_setup.md)
- 言い換え・ルビの一覧：[docs/wording_changes.md](docs/wording_changes.md)

## 画面の流れ

| ステップ | 画面 | ファイル |
|---|---|---|
| | はじめる（途中のデータがあれば「つづきから」） | `workshop/start/` |
| 1 場所 | 作品にする場所を6つから選ぶ（アピタテラス／新綱島駅／コンフォール南日吉／日吉の丘／北綱島ポンプ場／その他）。「その他」は地図をタップしてピンを置き、「ここでいいかな？」で確かめる | `workshop/map/Log/log_hazard_map.html` |
| 2 マーブリング | マーブリング | `workshop/marbling/app/` |
| 3 コラージュ | コラージュ | `workshop/collage/app/` |
| 4 メッセージ | タイトル・伝えたいこと・いつの行動か・番号 → 確認して登録（選んだ場所を表示） | `workshop/message/artwork/`、`workshop/message/lastconfirm/` |
| | 防災行動マップ（場所のボタン、または `?place=apita` など） | `workshop/present/` |

矢上小版からなくした画面：ハザードマップを見る画面（S1）、「1コマ目はここまで」の画面、場所の画面の「読み取ったハザードマップ」の選択、マーブリング・コラージュ中の「ハザードマップ」ボタン。
防災行動マップの作品ページの「ハザードマップを重ねる」（洪水・高潮・土砂災害をまとめて重ねる）と「この場所の危険性」の説明は残しています。

## 地点

- 地点の定義と座標：`workshop/common/places.js`（固定5か所の座標は国土地理院の住所検索 API で取得・確認した値。出典はファイルの先頭に書いてある）
- D1 の `place` 列：`apita`／`shintsunashima`／`conforte`／`hiyoshinooka`／`pump`／`other`
- `lat`／`lon`：固定5か所はその場所の座標、`other` は児童がピンを置いた座標（場所名は保存しない）
- 「その他」のピンを置ける範囲（綱島・日吉周辺）：北緯 35.525〜35.565、東経 139.620〜139.670（`places.js` の `MINOWA_AREA` と `worker/src/index.js` の `AREA`。Worker もこの範囲外を受け付けない）
- 防災行動マップ：固定5か所は「場所のピン（作品の数つき）」、「その他」の作品は作品ごとの小さなピン。「その他」の作品は場所の説明に「その他」と出し、「前の作品／次の作品」の対象にしない（1点ずつ表示）

## そのほかの決まり

- 作者は「クラス＋出席番号」の4桁（4年6組 → 4601〜4640）。Worker でも確かめる（`worker/src/index.js` の `NUMBER_RE`、`places.js` の `MINOWA_NUMBER_RE`）
- いつの行動か：保存する値は「事前／災害時／復旧時」のまま、画面は「災害の前／災害のとき／災害のあと」
- 「伝えたいこと」は D1 の `Body` 列。`field_24`（読み取ったハザードマップ）は使わない（空）
- ブラウザに保存する値（localStorage・IndexedDB）はすべて `minowa_` で始まる名前にしてある。同じ `bo-sci-art.github.io` で公開しているほかの版と、同じ iPad でも混ざらない

## 作品が消えないためのしくみ

- 今いる画面を `localStorage.minowa_wsResumePage` に覚え、スタート画面の「つづきから」で再開する（タブを閉じても・iPad がスリープしても残る）。「さいしょから」は確認してから消す
- マーブリング：「つぎへ」「もどる」で自動保存。戻ってきたら前の絵を表示し、そこから描き直せる
- コラージュ：スタンプを置く・動かす・消すたびに自動保存（IndexedDB `minowa_ws_art_db/images/collage_stamps`）
- 作品画像（長辺1000px JPEG）は `localStorage.minowa_artworkImage` と IndexedDB `artwork_image` の両方に保存。最終確認で見つからないときはマーブリング画像＋スタンプ配置から作り直す
- iPad への保存は、登録のあとに1回だけ（「ファイル」アプリの「ダウンロード」に入る）

## 設定を変える場所

- Worker の URL：`workshop/common/config.js`（`DEFAULT_WORKER`）と `workshop/message/lastconfirm/final_submit_script.js`（`WORKER_URL`）
- 送信用の合言葉：`final_submit_script.js` の `SUBMIT_SECRET`（Worker 側の `SUBMIT_SECRET` と同じ値）
- 防災行動マップの初期位置：`present/script.js` の `MINOWA_CENTER`

## テスト

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
node tools/serve.mjs 5500
```

（別のターミナルで `cd worker` → `npm run db:init:local` → `npm run dev` で手元の Worker を動かしてから）

```bash
node tools/e2e_flow.mjs http://127.0.0.1:8787 local-admin-key-for-test
```

```bash
node tools/load_test_30.mjs http://127.0.0.1:8787 local-admin-key-for-test 40
```

`tools/e2e_flow.mjs` は iPad の画面サイズ（横 1180×820 は固定の地点「新綱島駅」、縦 820×1180 は「その他」）で最初から登録・防災行動マップまでを通しで動かし、全画面のスクリーンショットを `tools/out/screens/` に保存します。ルビのない漢字・横のはみ出し・JS エラー・ほかの版の Worker へのアクセスがないかも調べます。テストで登録した作品は最後に DELETE で消します。

防災行動マップの使い方の写真（`workshop/present/guide_0N.jpg`・`detail_guide_0N.jpg`）は、見本の作品で撮ってあります。授業で作品が登録されたら、本物の作品で撮り直せます（`node tools/make_guide_images.mjs`。使い方はファイルの先頭）。
