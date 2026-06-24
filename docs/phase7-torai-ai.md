# Phase 7 設計：虎威 AI 下書き統合（A案：BYOK + 虎威アンロックキー）

## 0. 方針サマリ
- **無料コア・ビューア（認知）＋ 虎威会員限定の AI 下書き（成約）** のフリーミアム。
- **AI 生成は BYOK（ユーザー自身の Gemini API キー）でローカル実行** → 虎威の推論コストは 0。
- **ゲートは虎威への「subscription_status のみ」の問い合わせ**。Electron 側の Google OAuth は実装しない（A案）。
- ユーザーがアプリに登録するのは **(1) Gemini API キー / (2) 虎威アンロックキー（unlockKey）** の2つ（どちらも一度きり）。

```
[AI生成] アプリ内の Gemini キー(safeStorage) → ローカルで Gemini 直叩き（虎威コスト0）
[ゲート]  アプリ → checkFreeToolSubscriptionStatus {unlockKey} → {subscription_status} のみ
          active のときだけ AI 機能を有効化（inactive/失効時はセールス導線）
```

---

## 1. status 確認 API 契約（虎威 Function・**実装済み**）

虎威 Functions 側で実装・確定済み（`functions/src/handlers/freeTool.ts`）。アプリはこの実契約に合わせる。

### エンドポイント
```
POST https://asia-northeast1-<project-id>.cloudfunctions.net/checkFreeToolSubscriptionStatus
Content-Type: application/json
```
- **POST 専用**（GET は廃止。キーを URL クエリに乗せない）。

### リクエスト（body のみ）
```json
{ "unlockKey": "TORAI-..." }
```
- フィールドは `unlockKey`（別名 `key` も可）。

### レスポンス（200）
```json
{
  "success": true,
  "subscription_status": "active",   // "active" | "inactive"
  "subscriptionStatus": "active",     // 同値（キャメル別名）
  "cached": false,
  "checkedAt": "2026-06-21T00:00:00.000Z",
  "nextRefreshAt": "2026-07-01T00:00:00.000Z"
}
```
- 判定は `subscription_status === 'active'`。
- `nextRefreshAt`：サーバ側キャッシュ期限。アプリ側の再検証/オフライン猶予の目安に流用可。

### エラー
| HTTP | code | 意味 | アプリの挙動 |
| --- | --- | --- | --- |
| 405 | `method-not-allowed` | POST 以外 | （アプリは常に POST） |
| 400 | `invalid-argument` | キー未指定 | 入力エラー表示 |
| 403 | `permission-denied` | キーが無効/失効 | キー再登録を促す＋虎威セールスへ |
| 500 | `internal` | 一時障害 | キャッシュ状態を使用（オフライン猶予） |

> **重要な分岐**：`200 + subscription_status:'inactive'`（＝キーは有効だが非会員）と `403`（＝キーが無効/失効）は別物。前者は「サブスク必要」、後者は「キー再登録」へ誘導。

### サーバ側の挙動（確認済み）
- **キー保存はSHA-256ハッシュのみ**（生キーは保存しない）。`freeToolUnlockKeys/{keyHash}`。
- **status 取得**：`users/{uid}.subscriptionStatus`（`appPlanId === 'lifetime'` も active 扱い）。返すのは status のみ（キー/PII は返さない）。
- **サーバ側キャッシュ 10日**。ただし **`invalidateFreeToolCacheOnUserChange`（`users/{uid}` トリガー）が `subscriptionStatus`/`appPlanId` 変化時に該当キーのキャッシュを即破棄** → **状態変化は次回チェックで即反映**（新規加入の即解放／解約の即反映が成立）。
- **Firestore ルール**：`freeToolUnlockKeys` / `freeToolUnlockKeyUsers` はクライアント read/write 不可（Admin のみ）。

### アンロックキーのライフサイクル（虎威 Web 側・確認済み）
- `issueFreeToolUnlockKey`（Callable・要認証）で発行。**生キーは発行レスポンスで一度だけ返却**（保存はハッシュのみ）。
- **再発行で旧キーは `revoked:true` で失効**。失効キーは check 側で 403。
- 残課題（任意・優先度低）：公開 HTTP 関数の **レート制限 / App Check**（DoS・コスト対策）。

---

## 2. アプリ側 状態モデル

`safeStorage`（既存 `safeStorageWrapper.ts`）に暗号化保存：
- `geminiApiKey`（BYOK、生成に使用）
- `toraiUnlockKey`（ゲートに使用＝虎威アンロックキー）
- `lastStatus`: `{ active: boolean, nextRefreshAt?: string, checkedAt: string }`（オフライン猶予用キャッシュ。`active` は `subscription_status === 'active'` から導出）

### 再検証サイクル
- **起動時** ＋ **一定間隔**（例：6h）＋ **AI パネルを開いた時**。
- サーバが状態変化時にキャッシュを破棄するため、**起動時チェックで最新状態が即反映**される（新規加入の即解放）。
- オフライン/5xx 時は `lastStatus.active` を **`nextRefreshAt` または `checkedAt + N日` のいずれか早い方まで**有効とみなす（猶予日数 N は要決定）。
- `200 + inactive` → AI 無効化＋「サブスク必要」、`403` → AI 無効化＋「キー再登録」。いずれも虎威セールスへ（`shell.openExternal`、http/https ガード済み）。

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

### A. ゲート（虎威アンロックキー）
- [ ] channels：`SET_UNLOCK_KEY` / `CHECK_SUBSCRIPTION` 等を追加、preload に `setUnlockKey()/onAiAvailability()`、IPC 実装。
- [ ] 設定UI：虎威アンロックキーの登録/更新/クリア → safeStorage。
- [ ] main：`POST checkFreeToolSubscriptionStatus {unlockKey}` 呼び出し、`lastStatus` キャッシュ、再検証サイクル、オフライン猶予。`403`/`200+inactive` を区別して扱う。
- [ ] レンダラーへ「AI 利用可否」を配信 → AI UI をゲート。inactive/失効時は虎威セールスへの導線。

### B. Gemini キー（BYOK）
- [ ] 設定UI：Gemini キーの登録/クリア（任意で軽い疎通テスト）→ safeStorage。
- [ ] main：`generateDrafts` IPC（`@google/generative-ai`、postApi.ts 移植、サービス別プロンプト）。

### C. 下書き UI
- [ ] キーワード入力＋生成 → **48件の下書きリスト**（編集・選択）。
- [ ] 選択した下書き → **アクティブカラムの compose フロー**へ（`composePost`/`POST_TRIGGER` 再利用）or 事前入力。
- [ ] ローディング/進捗・エラー表示（更新ボタンの進捗パターンを流用）。

### D. 横断・設定
- [ ] エラー体系：無効キー(403) / 非会員(200+inactive) / Gemini 側エラー / コンテンツブロック。
- [ ] `@google/generative-ai` を依存追加（externalize＋同梱、ネイティブ依存なし）。
- [ ] ログにキー(Gemini/アンロック)を出さない。

---

## 5. 要決定事項

### 虎威側（確定済み ✅）
- ~~キーの寿命/失効~~ → 再発行で旧キー失効、check 側で 403。
- ~~レート制限・エラーコード~~ → エラーコード確定。レート制限/App Check のみ任意の残課題。
- ~~POST/GET~~ → POST 専用に確定。
- ~~サブスク変更の即時反映~~ → `users/{uid}` トリガーでキャッシュ破棄、確定。

### アプリ・プロダクト側（未決）
1. 再検証サイクル＋オフライン猶予日数 N。
2. v1 プロンプト：X 専用 / マルチSNS パラメータ化。
3. AI ゲートを**唯一の有料機能**にするか（＝ビューアは無料・フリーミアム確定か）。
4. Gemini モデル：`gemini-flash-lite-latest` 踏襲か見直しか。

## 6. スコープ外（今回見送り）
- node-llama-cpp によるローカルLLM（将来「キー不要・オフライン」版として再検討）。
- 虎威がサーバ側で生成する方式（推論コスト負担のため不採用）。
- アプリ内 Google OAuth（A案では不要）。
