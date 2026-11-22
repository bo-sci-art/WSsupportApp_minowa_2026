# Cloudflare の準備と運用（箕輪小版 Worker `minowa-submit`）

箕輪小版専用のリソースです。ほかの版の Worker・D1・R2 には一切さわりません。

| 種類 | 名前 | 備考 |
|---|---|---|
| Worker | `minowa-submit` | https://minowa-submit.kazuki131214.workers.dev |
| D1 | `minowa-artworks` | database_id `c1f869c4-8666-412c-a887-d87bed17460e`（`worker/wrangler.toml`） |
| R2 | `minowa-artworks` | 作品画像 |
| 変数 | `ALLOWED_ORIGINS` | `https://bo-sci-art.github.io`（`wrangler.toml`。localhost は常に許可） |
| シークレット | `SUBMIT_SECRET` | `minowa-ws-2026`（アプリの `final_submit_script.js` と同じ値。ページのソースから見える） |
| シークレット | `ADMIN_KEY` | 管理用（削除・書き出し）。値は `worker/.admin_key`（git に入らない）にだけある |

> コマンドは Git Bash で `worker` フォルダに入って実行します：`cd /c/Users/kazuk/WSsupportApp_minowa_2026/worker`
> （Git Bash ではパスの区切りに `\` ではなく `/` を使う。PowerShell では `npx` を `npx.cmd` にする）

## 作り直すとき・別のアカウントで作るとき

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create minowa-artworks
```

（「wrangler.toml に追加しますか？」には `n`。表示された database_id を `wrangler.toml` の `database_id` に書く）

```bash
npx wrangler d1 execute minowa-artworks --remote --file=schema.sql
```

```bash
npx wrangler r2 bucket create minowa-artworks
```

```bash
npx wrangler deploy
```

```bash
npx wrangler secret put SUBMIT_SECRET
```

（`minowa-ws-2026` と入力）

```bash
cat .admin_key | npx wrangler secret put ADMIN_KEY
```

URL が `https://minowa-submit.kazuki131214.workers.dev` でなかったら、`workshop/common/config.js` の `DEFAULT_WORKER` と `workshop/message/lastconfirm/final_submit_script.js` の `WORKER_URL` を直して push します。

## Worker のコードを直したとき

```bash
npx wrangler deploy
```

## 運用で使うコマンド

動作確認（最初は `{"type":"FeatureCollection","features":[]}`）：

```bash
curl https://minowa-submit.kazuki131214.workers.dev/artworks
```

全作品のバックアップ（GeoJSON）：

```bash
curl -H "Authorization: Bearer $(cat .admin_key)" -o minowa_artworks.geojson https://minowa-submit.kazuki131214.workers.dev/export
```

作品を1件消す（`<id>` は作品ページの URL `detail.html?id=<id>` の数字。画像も消える）：

```bash
curl -X DELETE -H "Authorization: Bearer $(cat .admin_key)" https://minowa-submit.kazuki131214.workers.dev/artworks/<id>
```

D1 の中身を直接見る：

```bash
npx wrangler d1 execute minowa-artworks --remote --command "SELECT id, place, lat, lon, field_25, Message, created_at FROM artworks ORDER BY id"
```

40件同時送信テスト（全件登録・直後に表示・場所ごとの件数を確認し、最後にテスト作品を自動で削除）：

```bash
cd .. && node tools/load_test_30.mjs https://minowa-submit.kazuki131214.workers.dev "$(cat worker/.admin_key)" 40
```

## 受け付ける作品（`worker/src/index.js`）

- 作者：ペンネーム 1〜10文字（`penName`。列は `field_25`）。`workshop/common/places.js` の `minowaPenName` と同じ決まりにする。ちがうときは `400 invalid penname`
- 地点の種類：`apita`／`shintsunashima`／`conforte`／`hiyoshinooka`／`pump`／`other`（`PLACES`）
- 座標：綱島・日吉周辺（北緯 35.525〜35.565、東経 139.620〜139.670）の中だけ（`AREA`）

「運営が確認してから公開」にしたいとき：INSERT 文の `'approved'` を `'pending'` にしてデプロイし、公開するときに次を実行します（`GET /artworks` は `status='approved'` だけを返す）。

```bash
npx wrangler d1 execute minowa-artworks --remote --command "UPDATE artworks SET status='approved' WHERE id=<id>"
```

## 手元（ローカル）で試すとき

`worker/.dev.vars`（git に入らない）に次の2行を書きます（作成済み）。

```
SUBMIT_SECRET=minowa-ws-2026
ADMIN_KEY=local-admin-key-for-test
```

```bash
npm run db:init:local
```

```bash
npm run dev
```

アプリは別のターミナルで `node tools/serve.mjs 5500` を動かし、
`http://127.0.0.1:5500/workshop/start/index.html?worker=http://127.0.0.1:8787` を開くと手元の Worker に送られます（`?worker=default` で本番にもどる）。

## 補足

- CORS で指定できるのはオリジン（`https://bo-sci-art.github.io`）までで、`/WSsupportApp_minowa_2026/` のようなパスでは区別できません。ほかの版のページからの送信は、合言葉・地点の種類・範囲のチェックで受け付けないようにしています。
- 画像は推測しにくいランダムなキーで R2 に保存し、`GET /images/<key>` で返します。

---

## 作品の管理画面（ふだんはこれを使う）

テスト作品やいたずらの作品を、ボタンで消したり、マップから隠したり、作品の情報を直したりできます。PC の Chrome か Edge（横幅 1280px 以上）で使います。直すときのパネルは iPad の Safari（縦でも）でも使えます。担任の先生向けの使い方は [teacher_edit_guide.md](teacher_edit_guide.md)。

- 場所：防災行動マップのヘッダー右にある小さな歯車（⚙）を押す。または `https://bo-sci-art.github.io/WSsupportApp_minowa_2026/workshop/present/admin.html` を開く
- 入り方：合言葉の欄に `ADMIN_KEY`（`worker/.admin_key` の中身）を入れて「入る」。「このPCで覚える」にチェックをつけると、このブラウザに覚える（`minowaAdminKey`）
- 一覧：非公開の作品もふくめて全件。場所（6つ）・状態の絞り込み、ペンネーム・タイトルの検索、並び順（登録した順／ペンネームの順）
- 操作：行を押して選び、「削除する」（D1 の行と R2 の画像を消す。元に戻せない）・「非公開にする」・「公開に戻す」
- 確認・修正：ペンネーム・タイトル・伝えたいこと・場所・いつの行動かを直せる（画像・公開／非公開・登録日時は変わらない。箕輪小版は「見たハザードマップ」を使わないので出さない）
  - 固定の5か所に変えると、ピンはその場所の座標に移る
  - 「その他」に変えると、パネルの地図でピンを置く（赤い枠＝綱島・日吉周辺の中だけ）。「その他」の作品は、地図をタップしたときだけピンが動く
  - 「その他」から固定の場所に変えたときは、児童が置いたピンを D1 の `extra.original_pin` に残す。あとで「その他」に戻すと、そのピンから始まる
  - 直した日時は `extra.updated_at`（一覧の「最終修正」）。D1 の列は変えていない（`extra` 列は最初から schema.sql にある）
- ログアウト：「ログアウト（覚えた合言葉を消す）」。自分のものでない PC で使ったあとは必ず押す

手元の Worker で試すときは `http://127.0.0.1:5500/workshop/present/admin.html?worker=http://127.0.0.1:8787` を開き、合言葉に `local-admin-key-for-test` を入れます。

Worker の窓口（どれも `Authorization: Bearer <ADMIN_KEY>` が必要）：

- `PATCH /artworks/<id>`：`{"status":"approved"}` か `{"status":"hidden"}`（公開・非公開）
- `PUT /artworks/<id>`：直す項目だけを送る（`field_25`・`Message`・`Body`・`place`・`field_23`。場所を「その他」にするときは `lat`・`lon` も）。登録と同じ基準で確かめる。エラーは `invalid penname`・`invalid place`・`invalid phase`・`too long`・`pin required`・`location out of area`・`pin only for other` など

## 作品の受け付けを止める・再開する

箕輪小はこれから授業があるので、今は**受け付けています**（`true`）。授業が終わって止めるときは、次の2か所を両方 `false` にします。

- Worker：`worker/wrangler.toml` の `[vars]` の `REGISTRATION_OPEN = "true"` → `"false"`（止めているときの `POST /submit` は `403` と `{"ok":false,"error":"registration closed"}`）
- 画面：`workshop/common/config.js` の `var REGISTRATION_OPEN = true;` → `false`（スタート画面は「防災行動マップを見る」だけになり、「箕輪小学校の授業は終わりました」と出る）
- 止めているときも、防災行動マップと管理画面（一覧・削除・非公開・確認と修正）は使える
- ダッシュボードの「Variables and Secrets」だけで値を変えると、次に `wrangler deploy` したときに `wrangler.toml` の値で上書きされるので、`wrangler.toml` で変える

止めたあとの確かめ方（作品は登録されません。403 が返れば止まっています）：

```bash
curl -i -X POST -H "Content-Type: application/json" -d "{}" https://minowa-submit.kazuki131214.workers.dev/submit
```

## 新しい機能を本番に出す順番（Worker が先、画面があと）

管理画面の「確認・修正」と「非公開」は、Worker の新しい窓口（`PUT`・`PATCH`）を使います。**かならず Worker を先にデプロイして、そのあと main に push（GitHub Pages）します。**
（画面だけが先に新しくなると、「保存する」を押しても古い Worker には窓口がないので「保存できませんでした」になる。Worker が先なら、古い画面のままでも困らない）

1. バックアップ：`curl -H "Authorization: Bearer $(cat .admin_key)" -o minowa_artworks_before.geojson https://minowa-submit.kazuki131214.workers.dev/export`
2. Worker：`cd worker` → `npx wrangler deploy`
3. 確かめる：`curl -i -X PUT https://minowa-submit.kazuki131214.workers.dev/artworks/1` が `401 unauthorized` なら新しい Worker（古いと `404 not found`）
4. 画面：main に push する。GitHub の Actions の「pages build and deployment」が緑になったら反映済み
5. 本番で1件だけ直して確かめる（管理画面で「確認・修正」→ 1か所直して保存 → 防災行動マップで確かめる → 必要なら元にもどす）
