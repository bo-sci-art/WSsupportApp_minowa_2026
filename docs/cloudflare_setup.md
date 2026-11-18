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

- 番号：4601〜4640（`NUMBER_RE`）。人数が決まったら、ここと `workshop/common/places.js` の `MINOWA_NUMBER_RE` を同じに直す
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

- CORS で指定できるのはオリジン（`https://bo-sci-art.github.io`）までで、`/WSsupportApp_minowa_2026/` のようなパスでは区別できません。ほかの版のページからの送信は、合言葉・番号（46xx）・地点の種類・範囲のチェックで受け付けないようにしています。
- 画像は推測しにくいランダムなキーで R2 に保存し、`GET /images/<key>` で返します。
