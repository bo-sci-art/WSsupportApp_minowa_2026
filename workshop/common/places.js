// workshop/common/places.js（箕輪小版）
// 作品にする地点は、次の6つから児童が選ぶ。
//   固定5か所：アピタテラス／新綱島駅／コンフォール南日吉／日吉の丘／北綱島ポンプ場（座標は固定）
//   その他    ：地図をタップしてピンを置いた場所（緯度経度だけを保存する。場所名は入力させない）
// 座標は国土地理院の住所検索 API（msearch.gsi.go.jp/address-search）で 2026/11/14 に取得・確認した値（新綱島駅は 2026/11/18）
//   アピタテラス     綱島東四丁目3番            35.54195, 139.641434（API の値＝参考値と同じ）
//   新綱島駅         東急新横浜線 新綱島駅       35.536551, 139.636642（API の「新綱島駅」の点。住所は API の逆引きで綱島東一丁目）
//   コンフォール南日吉 日吉本町四丁目10番        35.546082, 139.634018（API の値。UR 団地の中心付近）
//   日吉の丘         箕輪町三丁目13番           35.548008, 139.642441（API の値。日吉の丘公園）
//   北綱島ポンプ場    日吉六丁目14番1号          35.53960528, 139.65348008（参考値。API の値 35.539631, 139.652786 と同じ街区内・約60m）
//
//   id    : 保存する値（D1 の place 列）。worker/src/index.js の PLACES と同じにする
//   name  : 画面に出す名前（ふりがなは 漢字{かな} の書き方。ruby.js が <ruby> にする）
//   plain : ふりがななしの名前
//   ※固定5か所の座標を変えるときは、worker/src/index.js の PLACE_COORDS も同じ値にすること（管理画面で場所を直したとき、Worker がこの座標にピンを移す）
(function () {
  window.MINOWA_PLACES = [
    { id: 'apita',        name: 'アピタテラス',                     plain: 'アピタテラス',       short: 'アピタテラス',                     lat: 35.54195,    lon: 139.641434,   color: '#e8590c' },
    { id: 'shintsunashima', name: '新綱島駅{しんつなしまえき}',      plain: '新綱島駅',           short: '新綱島駅{しんつなしまえき}',      lat: 35.536551,   lon: 139.636642,    color: '#2f80ed' },
    { id: 'conforte',     name: 'コンフォール南日吉{みなみひよし}',   plain: 'コンフォール南日吉', short: 'コンフォール南日吉{みなみひよし}',   lat: 35.546082,   lon: 139.634018,   color: '#9333ea' },
    { id: 'hiyoshinooka', name: '日吉{ひよし}の丘{おか}',            plain: '日吉の丘',           short: '日吉{ひよし}の丘{おか}',            lat: 35.548008,   lon: 139.642441,   color: '#16a34a' },
    { id: 'pump',         name: '北綱島{きたつなしま}ポンプ場{じょう}', plain: '北綱島ポンプ場',   short: '北綱島{きたつなしま}ポンプ場{じょう}', lat: 35.53960528, lon: 139.65348008, color: '#0891b2' }
  ];
  // 「その他」：座標は作品ごとにちがう（ピンを置いた場所）
  window.MINOWA_OTHER = { id: 'other', name: 'その他{た}', plain: 'その他', short: 'その他{た}', color: '#db2777', isOther: true };
  // 選ぶときに出す6つ（固定5か所＋その他）
  window.MINOWA_CHOICES = window.MINOWA_PLACES.concat([window.MINOWA_OTHER]);

  // ピンを置ける範囲（綱島・日吉周辺）。worker/src/index.js の AREA と同じにする
  window.MINOWA_AREA = { south: 35.525, north: 35.565, west: 139.620, east: 139.670 };
  window.minowaInArea = function (lat, lon) {
    var a = window.MINOWA_AREA;
    return isFinite(lat) && isFinite(lon) && lat >= a.south && lat <= a.north && lon >= a.west && lon <= a.east;
  };
  window.minowaAreaBounds = function () {
    var a = window.MINOWA_AREA;
    return [[a.south, a.west], [a.north, a.east]];
  };

  window.minowaPlace = function (id) {
    for (var i = 0; i < window.MINOWA_CHOICES.length; i++) if (window.MINOWA_CHOICES[i].id === id) return window.MINOWA_CHOICES[i];
    return null;
  };
  window.minowaIsOther = function (id) { return id === 'other'; };
  // 作品の地点（place 列の値から）
  window.minowaPlaceOf = function (placeId) {
    return window.minowaPlace(placeId);
  };
  // いつの行動か（保存する値は 事前／災害時／復旧時 のまま。画面の言葉は授業のインプットに合わせる）
  window.MINOWA_PHASES = [
    { value: '事前',   label: '災害{さいがい}の前{まえ}',   desc: '災害{さいがい}が起{お}きる前{まえ}の準備{じゅんび}', key: 'prior' },
    { value: '災害時', label: '災害{さいがい}のとき',      desc: '身{み}を守{まも}る・避難{ひなん}する', key: 'during' },
    { value: '復旧時', label: '災害{さいがい}のあと',      desc: 'くらしを取{と}り戻{もど}す', key: 'recovery' }
  ];
  window.minowaPhaseLabel = function (v) {
    for (var i = 0; i < window.MINOWA_PHASES.length; i++) if (window.MINOWA_PHASES[i].value === v) return window.MINOWA_PHASES[i].label;
    return v || '';
  };
  // 作者の番号：クラス＋出席番号の4桁（4年6組 → 4601〜4640）。worker/src/index.js の NUMBER_RE と同じにする
  window.MINOWA_NUMBER_RE = /^46(0[1-9]|[1-3][0-9]|40)$/;
  // 地図に固定5か所が全部入る範囲
  window.minowaPlacesBounds = function () {
    return window.MINOWA_PLACES.map(function (p) { return [p.lat, p.lon]; });
  };
})();
