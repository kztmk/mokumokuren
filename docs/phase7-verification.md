# Phase 7 実機確認手順書（虎威 AI 下書き）

虎威ゲート（サブスク可否）＋ BYOK Gemini 下書き生成を、実機で動作確認するための手順。
対象コミット: `feature/phase7`（未コミットの作業ツリーでも可）。

---

## 0. 事前準備

### 用意するもの
| 種別 | 用途 | 入手元 |
| --- | --- | --- |
| **虎威アンロックキー（active 会員）** | ゲートが `active` を返す正常系 | 虎威 Web の管理画面 `issueFreeToolUnlockKey` で発行（`TORAI-...`） |
| 虎威アンロックキー（非会員 / inactive）※任意 | `200 + inactive` の分岐確認 | 非会員ユーザーで発行したキー |
| 虎威アンロックキー（失効 / revoked）※任意 | `403`（invalid-key）の分岐確認 | 再発行して**旧キー**を使う（再発行で旧キーは失効） |
| **Gemini API キー** | BYOK ローカル生成 | Google AI Studio |

> active キー1本だけでも主要フロー（A〜F・I・J）は確認できる。inactive/invalid は任意。

### 環境
- macOS（safeStorage = Keychain）を推奨。本確認の主対象。
- **2段階で確認する**:
  1. **merge 前 = preview** で確認（functions は preview にのみデプロイ済み）。
  2. **merge 後 = prod**（`torai-e0d8e`）で再確認。
- 問い合わせ先は `TORAI_FUNCTIONS_BASE` で切り替わる（`toraiGate.ts`、既定は prod）:
  - preview: `https://asia-northeast1-torai-preview.cloudfunctions.net`
  - prod:    `https://asia-northeast1-torai-e0d8e.cloudfunctions.net`

### 起動
```bash
npm install        # 初回のみ（@google/generative-ai が入る）

# merge 前：preview に向けて確認（TORAI_FUNCTIONS_BASE を preview に固定したスクリプト）
npm run dev:preview

# merge 後：prod（既定）で再確認
npm run dev
```
- dev は DevTools が開ける。main 側のログは **起動したターミナル**に出る。
- 機微データの保存先（リセット時に使用）:
  `~/Library/Application Support/mokumokuren/secrets.json`
- ⚠ 環境を切り替えたら、キーを保存し直す（または `secrets.json` 削除）で
  前環境の `gateStatus` キャッシュを破棄してから確認すること（§5）。

---

## 1. 状態の早見表

`AiState.reason` と期待される UI:

| reason | 意味 | パネル状態バー | available |
| --- | --- | --- | --- |
| `no-unlock-key` | アンロックキー未登録 | ○「虎威アンロックキーを登録してください」 | false |
| `checking` | 確認中 | ⟳「状態を確認中…」＋[再確認] | false |
| `ok` | active 会員 | ●「AI 下書きが利用できます」（緑） | **true** |
| `inactive` | キー有効・非会員 | ○「虎威サブスクリプションが必要です」＋[虎威を確認] | false |
| `invalid-key` | 403 失効/無効 | ○「アンロックキーが無効または失効…再登録」＋[虎威を確認] | false |
| `error` | 一時障害＋猶予切れ | ○ エラー文＋[再確認] | false |
| `unavailable` | safeStorage 不可 | ○「安全な保存が利用できません」 | false |

---

## 2. 確認シナリオ

各シナリオは **操作 → 期待結果**。チェック欄は §4 を使用。

### A. UI エントリ（🤖 ボタン）
1. 起動直後、左サイドバー下部（投稿✎ボタンの上）に **🤖 ボタン**がある。
2. クリック → 右側に **AI 下書きパネル**が全面表示され、背後のカラム（SNS webview）が隠れる。
3. パネル右上「✕ 閉じる」→ パネルが閉じ、**カラムが元のレイアウトで復帰**する。
   - 期待: カラムがズレたり消えたままにならない（`setColumnsVisible` の復帰）。

### B. キー未登録の初期状態
1. （secrets 未設定の状態で）パネルを開く。
2. 状態バー = `no-unlock-key`。設定パネルが**自動で開いている**（`available=false` のため）。
3. 「48件生成」ボタンが**無効**（グレー）。

### C. Gemini キー登録（BYOK）
1. 設定の「Gemini API キー（BYOK）」に有効キーを貼り付け → 「保存」。
2. 「Gemini API キーを保存しました。」表示、バッジが **登録済み**（緑）。
3. ターミナルログに **キー文字列が出ていない**こと（§3）。
4. 「削除」→ バッジ **未登録**に戻る。再度登録しておく。

### D. 虎威キー登録 → active（正常系の心臓部）
1. 設定の「虎威アンロックキー」に **active 会員キー**を貼り付け → 「保存」。
   - 入力は自動で trim + 大文字化される（`TORAI-...`）。
2. 一瞬 `checking`（⟳）→ サーバ応答後 **`ok`（●緑）「AI 下書きが利用できます」**。
3. Gemini キーも登録済みなら「48件生成」ボタンが**有効**になる。

### E. 下書き生成（サービス別）
前提: D で `ok` ＋ Gemini 登録済み。**アクティブカラムのサービス**が対象になる。
1. パネルヘッダ「対象: ○○」が、現在アクティブなアカウントの SNS（X / Bluesky / Threads）になっている。
   - 変えたい場合は一度閉じ、サイドバーで対象アカウントをアクティブにしてから開き直す。
2. キーワード（例「朝活」）を入力 → 「48件生成」（Enter でも可）。
3. 「生成中…」→ 数秒〜十数秒で **下書きカードが最大48件**並ぶ。
4. 各カードに本文と **文字数**が出る。サービスごとの目安（X≒140 / Bluesky≒300 / Threads≒500）に概ね沿う。
5. **X / Bluesky / Threads それぞれ**で 1 回ずつ生成し、プロンプトのプラットフォーム差が効いているか確認。

### F. 採用 / コピー
1. 任意カードの「コピー」→ ボタンが「コピー済」に一瞬変化。エディタ等に貼って中身一致を確認。
2. 「採用」→ 本文がクリップボードにコピーされ、パネルが閉じ、**アクティブカラムの投稿作成フローが開く**（`composePost`）。
   - 期待: 作成画面に切り替わる。本文は手動ペースト（Cmd+V）で入る。

### G. 非会員キー（inactive）※任意
1. 設定で虎威キーを **非会員キー**に差し替え → 保存。
2. 状態バー = `inactive`「虎威サブスクリプションが必要です」＋ **[虎威を確認]**。
3. [虎威を確認] → 既定ブラウザで虎威サイトが開く（アプリ内には開かない）。
4. 「48件生成」は無効のまま。

### H. 失効/無効キー（invalid-key / 403）※任意
1. 設定で虎威キーを **失効済みキー**（または出鱈目な `TORAI-XXXX`）に差し替え → 保存。
2. 状態バー = `invalid-key`「無効または失効…再登録してください」＋[虎威を確認]。
3. inactive（G）と**別メッセージ**になっていること（403 と 200+inactive の区別）。

### I. オフライン猶予
前提: 直前に D で `ok` を取得済み（キャッシュに active が残っている）。
1. Wi-Fi を切る（または `TORAI_FUNCTIONS_BASE` を到達不能 URL にして再起動）。
2. パネルを開く / [再確認]。
3. 期待: すぐ `invalid-key` に落ちず、**`ok` のまま**「オフライン: 前回の状態を使用中（…）」表示で **available=true** を維持（猶予 = nextRefreshAt か checkedAt+3日 の早い方まで）。
4. オフラインのまま Gemini 生成を試すと、ゲートは通るが Gemini 呼び出し自体が `api` エラーになる（想定どおり）。
5. Wi-Fi を戻し [再確認] → 通常の `ok` に戻る。

### J. 永続化（再起動後）
1. active キー＋Gemini キー登録済みの状態でアプリを**完全終了**→ `npm run dev` で再起動。
2. パネルを開く: バッジが両方 **登録済み**、状態バーは（キャッシュ由来で即）`ok` 付近 → 起動チェックで確定。
3. `secrets.json` を開き、`geminiApiKeyEnc` / `toraiUnlockKeyEnc` が **base64 の暗号文**（生キーでない）であることを目視。

### K. レイアウト復帰の再確認
1. パネルを開く→閉じる、を 2〜3 回。
2. カラム数を変えても（アカウント追加/非表示）開閉後にレイアウトが崩れない。

---

## 3. セキュリティ確認（キー非露出）

- **ターミナルログ / DevTools Console** に、Gemini キー・虎威アンロックキーの**生文字列が一切出ない**こと。
- DevTools（レンダラー）で `window.electronAPI` を見ても、キー取得 API が無い（main 内に閉じている）こと。
  - 確認: Console で `Object.keys(window.electronAPI)` → `getAiState/setUnlockKey/setGeminiKey/generateDrafts` 等はあるが、**キーを read する関数は無い**。
- `secrets.json` の `geminiApiKeyEnc` / `toraiUnlockKeyEnc` が暗号文（§J-3）。

---

## 4. チェックリスト

```
[ ] A  🤖ボタン表示・パネル開閉・カラム復帰
[ ] B  未登録時 no-unlock-key・生成ボタン無効
[ ] C  Geminiキー 保存/削除・バッジ・ログ非露出
[ ] D  active キーで ok（緑）になる
[ ] E  X / Bluesky / Threads で48件生成・文字数目安
[ ] F  コピー一致・採用で作成フロー起動
[ ] G  inactive 分岐＋虎威を外部ブラウザで開く（任意）
[ ] H  invalid-key(403) が inactive と別表示（任意）
[ ] I  オフライン猶予で ok 維持→復帰（任意）
[ ] J  再起動後も登録維持・secrets.json は暗号文
[ ] K  開閉繰り返しでレイアウト崩れなし
[ ] S  ログ/Console/Bridge にキー非露出
```

---

## 5. 状態リセット / トラブル時

- **全リセット**（キー・キャッシュを消してやり直す）:
  ```bash
  rm "~/Library/Application Support/mokumokuren/secrets.json"
  ```
  （アプリ終了後に実行）
- **`unavailable` が出る**: その環境で safeStorage（Keychain）が使えない。実機 mac で再確認。
- **生成が `api` エラー**: Gemini キー無効・レート上限・ネットワーク。キー再確認。
- **ずっと `checking`**: サーバ未応答。ターミナルログ＋[再確認]。`TORAI_FUNCTIONS_BASE` の指定ミスも疑う。
- **状態が古い**: パネルを開くと `checkSubscription` が走る。サーバは状態変化時にキャッシュを破棄するため、加入/解約は次回チェックで反映される。
