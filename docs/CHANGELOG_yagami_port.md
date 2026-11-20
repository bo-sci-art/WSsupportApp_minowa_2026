# 矢上小版 v2・v3 の改善を箕輪小版に移した記録（2026/11）

- 移す前の状態：タグ `before-yagami-v3-port`（`ba65c68`）
- 移したもと：矢上小版 `../WSsupportApp_yagami_2026` のコミット `b30f69e..40aa9f9`（v2 `b30f69e..5306e6a`、v3 `v2-after-lesson..40aa9f9`）
- 履歴がつながっていないので、cherry-pick ではなく内容を読んで手で移した。コミットメッセージの先頭に、もとの矢上のコミット番号を書いてある
- 箕輪小版で変えてある部分（画面の流れ・6つの地点・番号 4601〜4640・`minowa_` の名前・Worker／D1／R2 の名前と `SUBMIT_SECRET`）は残した
- `?v=` は、変えたファイルを指しているものを箕輪小版の書き方（`?v=minowaN`）で1つずつ上げた
- D1 の列は変えていない（非公開は `status='hidden'`、直した日時とピンの記録は今ある `extra` 列）

## そのまま移したもの

| 矢上のコミット | 内容 | 箕輪のコミット | おもなファイル |
|---|---|---|---|
| `a78387c` | iPad の Safari 対策：「つぎへ」「もどる」「修正完了」の行き先を完全なアドレスに（404 を防ぐ）、プライベートモードで IndexedDB に Blob を保存できないときは data URL で保存、ふりがなを rt の position に頼らない形に | `3f6aef4` | `common/nav.js`・`common/ruby.js`・各画面の CSS、`marbling/app/detail/script.js`、`collage/app/index.html`、`message/lastconfirm/final_submit_script.js` |
| `ba8c66d`（一部） | ふりがなのずれ（漢字をベースラインでそろえる）、確認画面（S8）の一覧のスクロール、タグの行を切らない | `3f6aef4` | 各画面の CSS、`final_submit_script.js`・`final_submit_styles.css` |
| `f418a9c` | コラージュでタップ位置とスタンプの位置がずれる不具合（`#stage` を枠いっぱいに重ねる・ResizeObserver などで合わせ直す・スタンプを絵の中の割合で移す） | `f10208c` | `collage/app/detail/app.js`・`styles.css` |
| `a0a5b34`・`a7b000f` | コラージュの途中で「◀ マーブリングを直す」（`prevLabel`・`returnNotice`）。もどってきたら「✏️ 直しています」と案内 | `562577c` | `common/nav.js`・`common/styles.css`・`collage/app/index.html`・`marbling/app/index.html`・`marbling/app/detail/script.js` |
| `e0b3c59` | 登録したあとに作品の画像を端末へ自動で保存する機能の削除 | `ecb0a21` | `final_submit.html`・`final_submit_script.js`・`final_submit_styles.css`・`start/index.html` |
| `5306e6a` | 管理画面の並び順（登録した順／出席番号の順） | `761c8fd` | `present/admin*.{html,js}` |

## 箕輪に合わせて変えて移したもの

| 矢上のコミット | 内容 | 箕輪のコミット | 箕輪で変えたところ |
|---|---|---|---|
| `a0a5b34` | マーブリングを直す | `562577c` | マーブリングの「もどる」の行き先は、箕輪の流れどおり場所の画面のまま。`?from=collage` は URL だけで判定し、保存のキーは増やしていない |
| `b2478d3` | 新しい作品の登録を止められる仕組み（`REGISTRATION_OPEN`） | `f236266` | 箕輪小はこれから授業があるので、`config.js` も `wrangler.toml` も **`true`（受け付ける）**。止めたときの文言は「箕輪小学校の授業は終わりました」（ふりがなつき） |
| `f3cd83b`・`073f742`・`932d184` | 管理画面（削除・非公開・公開に戻す・確認と修正）、Worker の `PATCH`・`PUT /artworks/:id`、先生向けの使い方 | `761c8fd` | 場所は6種類、番号は 4601〜4640、`field_24`（見たハザードマップ）は直せる項目からもパネルからも外した。合言葉の名前は `minowaAdminKey`。先生向けの使い方は箕輪の画面で作り直し、「担任の先生へ」に |
| `073f742`・`932d184` | 場所を直したときの座標 | `761c8fd` | **「その他」の扱い（案A）**：固定→固定はその場所の座標へ。その他→固定は座標を移し、児童のピンを `extra.original_pin` に残す。固定→その他はパネルの地図でピンを置く（範囲の中だけ。送られてこないときは `original_pin`、どちらもなければ `400 pin required`）。その他→その他はピンを動かしたときだけ座標を変える |
| `ba8c66d`（一部） | 防災行動マップの絞り込みを、トグルに入れずいつも出す | `4f1ecdc` | そのまま移した（ハザードマップを重ねながら作品を見られるように）。箕輪は場所のボタンが7つあるので、横向きでは一覧の2枚目のカードが少し切れる |
| `5a1b9a5`（一部）・`4e1377f`（一部） | 防災情報の「水が街からあふれる（内水氾濫）」の説明とリンク、洪水の説明の一文、わいわい防災マップのリンク | `4f1ecdc` | わいわい防災マップ（内水・地震）の中心を、箕輪の固定5か所のまん中あたり（35.5424, 139.6416）に |

## 移さなかったもの

| 矢上のコミット | 内容 | 理由 |
|---|---|---|
| `5a1b9a5`（ほか） | 内水氾濫を災害の選択肢・確認画面・作品ページの注記・災害の絞り込みに戻す | 箕輪小版には災害を選ぶ画面とハザードマップの画面がない（防災情報パネルの説明とリンクだけは移した） |
| `4e1377f`（ほか） | 白地図のふりがな | 箕輪は `ba65c68` で対応済み |
| `4e1377f`（ほか） | 指定緊急避難場所の解説の下線 | 箕輪小版には同じ箇所がない（その解説はハザードマップの画面 `map/app/detail` の中にあり、その画面は削除済み） |
| `4e1377f`（ほか） | 内水と地震のリンクを矢上の学区に・パレットの順 | 矢上の学区用。パレットは箕輪独自の色と並び |
| `ba8c66d`（ほか） | 番号 4201〜4235・使い方の写真の撮り直し | 矢上の番号。写真は箕輪の画面で撮ってある |
| `b2478d3`（ほか） | `REGISTRATION_OPEN = false` | 矢上の授業が終わったための設定。箕輪は `true` |
| `40aa9f9` | `docs/CHANGELOG_v3.md` | 矢上の記録。このファイルが箕輪の記録 |
| （削除済みの画面） | `map/app/`・`map/Log/break.html` への変更 | 箕輪小版にその画面がない |

## テスト

- 新しく入れたテスト（矢上のものを箕輪向けに直した）：`tools/test_collage_tap.mjs`・`tools/test_marbling_redo.mjs`・`tools/test_registration_switch.mjs`・`tools/test_edit_api.mjs`・`tools/test_admin_edit.mjs`
- `tools/e2e_flow.mjs`：`BROWSER=webkit`（と `PERSIST=1`）で Safari と同じエンジンで通せるように。行き先は `workshop/` から確かめる。登録してもダウンロードしないことを確かめる
- 結果は下の「手元での確認の結果」

## 本番に出す手順（まだ出していない）

このコミットは手元だけにあり、`wrangler deploy` も main への push もしていません。出すときは **Worker が先、画面があと** です（画面だけが先に新しくなると、管理画面の「保存する」「非公開にする」が古い Worker では使えないため）。

1. 本番のデータを書き出しておく（`worker` フォルダで）：
   ```bash
   curl -H "Authorization: Bearer $(cat .admin_key)" -o minowa_artworks_before_port.geojson https://minowa-submit.kazuki131214.workers.dev/export
   ```
2. Worker をデプロイする（`worker` フォルダで）：
   ```bash
   npx wrangler deploy
   ```
   - `wrangler.toml` に `REGISTRATION_OPEN = "true"` が入っている（受け付ける）
   - D1 の列は変えないので、`ALTER TABLE` などはいらない
3. 新しい Worker になったか確かめる（合言葉なしなので 401 が返れば OK。古いと 404）：
   ```bash
   curl -i -X PUT https://minowa-submit.kazuki131214.workers.dev/artworks/1
   ```
4. main に push する（GitHub Pages が新しくなる）：
   ```bash
   git push origin main
   ```
5. 本番で確かめる：防災行動マップの歯車（⚙）→ 管理画面に `worker/.admin_key` の合言葉で入る → 試しの作品を1件「確認・修正」で直して保存 → マップで確かめる → 元にもどす（または試しの作品なら削除）
6. 授業が終わったら、`config.js` と `wrangler.toml` の `REGISTRATION_OPEN` を両方 `false` にして、2 → 4 の順でもう一度出す

## 手元での確認の結果

手元の Worker（`wrangler dev --local`）と手元のアプリ（`tools/serve.mjs`）で、次をすべて通した（2026/11/19〜20）。テストで登録した作品は、どれも最後に消している。

| テスト | Chromium | WebKit（Safari と同じ。プライベートモードと同じ状態） |
|---|---|---|
| `tools/e2e_flow.mjs`（横 1180×820 は新綱島駅、縦 820×1180 は「その他」。同じ場所に10件） | 問題なし | 問題なし |
| `tools/test_collage_tap.mjs` | すべて OK | すべて OK |
| `tools/test_marbling_redo.mjs`（2往復・マーブリングの「もどる」は場所の画面） | すべて OK | すべて OK |
| `tools/test_edit_api.mjs`（「その他」の4通りの直し方をふくむ） | すべて OK | — |
| `tools/test_admin_edit.mjs`（PC と iPad 縦） | すべて OK | — |
| `tools/test_registration_switch.mjs --worker open`／`--worker closed` | すべて OK | — |
| `tools/load_test_30.mjs`（40件同時） | 結果: OK | — |

通しテストのスクリーンショット（`tools/out/screens/`）で、画面の流れ（1 場所・2 マーブリング・3 コラージュ・4 メッセージ）、コラージュの「◀ マーブリングを直す」、防災行動マップの絞り込み（いつも表示）・白地図（はくちず）／写真・歯車を確かめた。
実機の iPad（Safari）では、まだ確かめていない。

## 気づいたこと（今回は直していない）

- 防災行動マップの使い方の写真（`guide_0N.jpg`・`detail_guide_0N.jpg`）は、移したあとの画面（絞り込みをいつも表示・歯車つき）で、手元の Worker に入れた見本の作品で撮り直した（見本は撮ったあとに消した）。授業の作品で撮り直すときは `tools/make_guide_images.mjs`
- 本番に、試しに登録された作品が4件ある（id 15〜18）
