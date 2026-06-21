# Phase 7 設計：虎威 AI 下書き統合（A案：BYOK + status トークン）

## 0. 方針サマリ
- **無料コア・ビューア（認知）＋ 虎威会員限定の AI 下書き（成約）** のフリーミアム。
- **AI 生成は BYOK（ユーザー自身の Gemini API キー）でローカル実行** → 虎威の推論コストは 0。
- **ゲートは虎威への「subscription_status のみ」の問い合わせ**。Electron 側の Google OAuth は実装しない（A案）。
- ユーザーがアプリに登録するのは **(1) Gemini API キー / (2) 虎威 status トークン** の2つ（どちらも一度きり）。

```
[AI生成] アプリ内の Gemini キー(safeStorage) → ローカルで Gemini 直叩き（虎威コスト0）
[ゲート]  アプリ → 虎威Function /verifyStatus {token} → {active} のみ
          active のときだけ AI 機能を有効化（失効時はセールス導線）
```

---

## 1. status 確認 API 契約（虎威 Function）

### エンドポイント
`POST /verifyStatus`（HTTPS Function。Firebase callable でも可）

### リクエスト
```json
{ "token": "<虎威が発行した不透明な status トークン>" }
```

### レスポンス（200）
```json
{
  "active": true,
  "expiresAt": "2026-07-20T00:00:00Z",   // 任意: 次回再検証の目安（オフライン猶予の上限に使用）
  "plan": "standard"                       // 任意: 表示用
}
```
- `active`: `subscription_status === 'active'` の真偽。
- `expiresAt`: 任意。アプリの再検証サイクル／オフライン猶予の上限に使う。

### エラー
| HTTP | code | 意味 | アプリの挙動 |
| --- | --- | --- | --- |
| 401 | `invalid_token` | 未知/失効トークン | トークン再登録を促す＋虎威セールスへ |
| 403 | `inactive` | トークンは有効だがサブスク非アクティブ | 「虎威のサブスクが必要」＋セールスへ |
| 429 | `rate_limited` | レート上限 | バックオフし、キャッシュ状態を使用 |
| 5xx | `server_error` | 一時障害 | キャッシュ状態を使用（オフライン猶予） |

> 設計上、`inactive` を 200 + `{active:false}` で返しても良い（アプリ側の分岐は同じ）。エラーコード体系は虎威側の都合で確定。

### 虎威側の実装メモ
- **トークン → uid 解決**：`statusTokens/{token} → { uid, createdAt, revoked }`（Firestore）。
- **status 取得**：`users/{uid}.subscription_status` を読む（Admin SDK）。
- **返すのは status のみ**（キー・PII は返さない）。✓ status-only。
- **自動失効**：サブスクが切れれば次回チェックで `active:false`。
- **レート制限**：トークン単位（例：60 req/時）。共有・総当たり対策。
- **Firestore ルール**：`statusTokens` はクライアント read/write 不可（サーバのみ）。`subscription_status` は本人 read のみ・書き込みは決済 Webhook（Functions）のみ（既存）。

### トークン・ライフサイクル（虎威 Web 側）
- active 会員が **status トークンを発行**（不透明・ランダム）。
- 再発行 / 失効 / ローテーション可能。
- 既定は「長期・失効可能」。必要なら短命＋リフレッシュも検討（要否は虎威側で判断）。

---

## 2. アプリ側 状態モデル

`safeStorage`（既存 `safeStorageWrapper.ts`）に暗号化保存：
- `geminiApiKey`（BYOK、生成に使用）
- `toraiStatusToken`（ゲートに使用）
- `lastStatus`: `{ active: boolean, expiresAt?: string, checkedAt: string }`（オフライン猶予用キャッシュ）

### 再検証サイクル
- **起動時** ＋ **一定間隔**（例：6h）＋ **AI パネルを開いた時**。
- オフライン/5xx 時は `lastStatus.active` を **`expiresAt` または `checkedAt + N日` のいずれか早い方まで**有効とみなす（猶予日数 N は要決定）。
- `active:false` / `invalid_token` を受けたら AI 機能を無効化し、虎威セールスへ（`shell.openExternal`、http/https ガード済み）。

---

## 3. AI 生成（BYOK・ローカル）

- 依存：`@google/generative-ai`（ネイティブ依存なし → MSIX/公証に影響なし）。
- **生成は main で実行**し、IPC で `generateDrafts(keyword, service) → Draft[]`。キーはレンダラー／SNS webview に露出させない。
- 既存 `snake-sns/src/utils/AI/postApi.ts` を移植：
  - model `gemini-flash-lite-latest`、48件、JSON 出力、```` ```json ```` フェンス除去＋型ガード。
  - `Draft = { id: string; text: string; adopted: boolean }`（既存 `PostData` 相当）。
- **マルチSNS対応**：プロンプトをサービス別に（文字数 X=140 / Bluesky=300 / Threads=500、プラットフォーム名）。v1 は「文字数＋名称をパラメータ化」推奨。

---

## 4. アプリ側 タスク分解

### A. ゲート（status トークン）
- [ ] channels：`VERIFY_STATUS` 追加、preload に `verifyStatus()/onAiAvailability()`、IPC 実装。
- [ ] 設定UI：虎威 status トークンの登録/更新/クリア → safeStorage。
- [ ] main：虎威 `/verifyStatus` 呼び出し、`lastStatus` キャッシュ、再検証サイクル、オフライン猶予。
- [ ] レンダラーへ「AI 利用可否」を配信 → AI UI をゲート。非アクティブ時は虎威セールスへの導線。

### B. Gemini キー（BYOK）
- [ ] 設定UI：Gemini キーの登録/クリア（任意で軽い疎通テスト）→ safeStorage。
- [ ] main：`generateDrafts` IPC（`@google/generative-ai`、postApi.ts 移植、サービス別プロンプト）。

### C. 下書き UI
- [ ] キーワード入力＋生成 → **48件の下書きリスト**（編集・選択）。
- [ ] 選択した下書き → **アクティブカラムの compose フロー**へ（`composePost`/`POST_TRIGGER` 再利用）or 事前入力。
- [ ] ローディング/進捗・エラー表示（更新ボタンの進捗パターンを流用）。

### D. 横断・設定
- [ ] エラー体系：無効キー / Gemini 側エラー / コンテンツブロック / トークン無効・非アクティブ。
- [ ] `@google/generative-ai` を依存追加（externalize＋同梱、ネイティブ依存なし）。
- [ ] ログにキー/トークンを出さない。

---

## 5. 要決定事項（虎威・プロダクト側）
1. status トークンの寿命：長期・失効可能 / 短命＋リフレッシュ。
2. 再検証サイクル＋オフライン猶予日数 N。
3. v1 プロンプト：X 専用 / マルチSNS パラメータ化。
4. AI ゲートを**唯一の有料機能**にするか（＝ビューアは無料・フリーミアム確定か）。
5. レート制限値・エラーコード体系の確定（虎威 Function 側）。

## 6. スコープ外（今回見送り）
- node-llama-cpp によるローカルLLM（将来「キー不要・オフライン」版として再検討）。
- 虎威がサーバ側で生成する方式（推論コスト負担のため不採用）。
- アプリ内 Google OAuth（A案では不要）。
