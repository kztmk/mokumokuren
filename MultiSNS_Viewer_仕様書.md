# MultiSNS Viewer
## マルチSNSデスクトップビューアー 設計仕様書

| 項目 | 内容 |
|------|------|
| ドキュメント番号 | MSNV-SPEC-001 |
| バージョン | 1.0 |
| 作成日 | 2026年6月 |
| ステータス | Draft |
| 対象プラットフォーム | Windows / macOS / Linux |
| 実装技術 | Electron + WebContentsView |

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [対応SNSサービス](#2-対応snsサービス)
3. [システムアーキテクチャ](#3-システムアーキテクチャ)
4. [UIレイアウト仕様](#4-uiレイアウト仕様)
5. [サイドバー仕様](#5-サイドバー仕様)
6. [セッション管理仕様](#6-セッション管理仕様)
7. [アカウント管理仕様](#7-アカウント管理仕様)
8. [IPC通信仕様](#8-ipc通信仕様)
9. [ディレクトリ構成](#9-ディレクトリ構成)
10. [開発フェーズ](#10-開発フェーズ)
11. [セキュリティ仕様](#11-セキュリティ仕様)
12. [非機能要件](#12-非機能要件)
13. [注意事項・制約](#13-注意事項制約)

---

## 1. プロジェクト概要

### 1.1 目的

**MultiSNS Viewer** は、X (Twitter)・Bluesky・Threads など複数のSNSサービスを、単一のElectronデスクトップアプリケーションで同時に閲覧・操作するための汎用マルチSNSビューアーである。

各アカウントは独立したブラウザセッションを保持し、永続ログインをサポートする。Franz・Wavebox・Stationと同様のコンセプトで、特定サービスの複製ではなく**汎用ブラウザ的なツール**として設計する。

### 1.2 解決する課題

- 複数SNSアカウントの管理にブラウザの複数プロファイル・ウィンドウが必要で煩雑
- アカウント間でCookie・セッションが混在するリスク
- サービスをまたいだ一元的なナビゲーション操作ができない
- X Pro（旧TweetDeck）のような複数アカウント同時表示が有料サービスに限定されている

### 1.3 主要機能

- **最大10アカウントのカラム並列表示**（X / Bluesky / Threads を混在可能）
- **アカウントごとに完全分離されたブラウザセッション**（Cookie・キャッシュ・LocalStorage）
- **永続ログイン**（アプリ再起動後もセッション維持）
- **サービス対応サイドバーナビゲーション**（アクティブカラムのサービスに応じてメニュー切り替え）
- **アカウント追加・削除・並び替え**
- **デスクトップ通知**

---

## 2. 対応SNSサービス

### 2.1 サービス一覧

| サービス | 識別子 | ベースURL | iFrame禁止 | WebView対応 |
|---------|--------|----------|-----------|------------|
| X (Twitter) | `x` | `https://x.com` | ✅ | ✅ |
| Bluesky | `bluesky` | `https://bsky.app` | ❌ | ✅ |
| Threads | `threads` | `https://www.threads.net` | ✅ | ✅ |

> WebContentsView（Chromiumベース）を使用するため、iFrame禁止の制約は受けない。

### 2.2 サービスごとのナビゲーションマップ

```javascript
const NAV_MAP = {
  x: {
    home:          '/home',
    search:        '/explore',
    notifications: '/notifications',
    messages:      '/messages',
    bookmarks:     '/i/bookmarks',
    profile:       '/:username',
  },
  bluesky: {
    home:          '/',
    search:        '/search',
    notifications: '/notifications',
    messages:      '/messages',
    bookmarks:     '/profile/:username/lists',
    profile:       '/profile/:username',
  },
  threads: {
    home:          '/',
    search:        '/search',
    notifications: '/activity',
    messages:      null,           // Threads はDM非対応
    bookmarks:     '/saved',
    profile:       '/@:username',
  },
}
```

### 2.3 サービス追加の拡張性

`NAV_MAP` にエントリを追加し、アカウント設定で `service` を指定するだけで新サービスに対応できる設計とする。将来的に Mastodon・Misskey などのサービス追加を想定する。

---

## 3. システムアーキテクチャ

### 3.1 技術スタック

| コンポーネント | 技術 | 役割 |
|--------------|------|------|
| メインプロセス | Electron (Node.js) | ウィンドウ管理・セッション管理・IPC制御 |
| レンダラープロセス | HTML / CSS / Vanilla JS | UI（サイドバー・カラムヘッダー） |
| Webコンテンツ表示 | WebContentsView | 各アカウントのSNS表示 |
| セッション管理 | Electron session API | Cookieとキャッシュの分離・永続化 |
| IPC通信 | ipcMain / ipcRenderer | UI操作 → メインプロセスへの指示伝達 |
| 設定永続化 | electron-store | アカウント設定・レイアウト設定の保存 |
| セキュア保存 | Electron safeStorage | 認証トークンの暗号化 |

### 3.2 プロセス構成

```
┌─────────────────────────────────────────────────┐
│  Main Process (Node.js)                         │
│  ├── windowManager.js   BrowserWindow管理        │
│  ├── sessionManager.js  セッション分離・生成      │
│  ├── accountStore.js    electron-store永続化      │
│  └── ipcHandlers.js     IPCイベント処理           │
└────────────────┬────────────────────────────────┘
                 │ IPC (contextBridge)
┌────────────────▼────────────────────────────────┐
│  Renderer Process (Browser)                     │
│  ├── sidebar.js         サイドバーUI・状態管理    │
│  ├── columnHeader.js    カラムヘッダーUI          │
│  └── preload.js         contextBridge API公開    │
└────────────────┬────────────────────────────────┘
                 │ setBounds / loadURL
┌────────────────▼────────────────────────────────┐
│  WebContentsView × 10                           │
│  ├── session: persist:account-{id}-{service}    │
│  └── x.com / bsky.app / threads.net            │
└─────────────────────────────────────────────────┘
```

---

## 4. UIレイアウト仕様

### 4.1 画面構成

| エリア | サイズ | 説明 |
|-------|--------|------|
| 左サイドバー | 固定幅 72px | SNSナビゲーション（上段）+ アカウントリスト（下段） |
| カラムヘッダー | 固定高 40px | アカウント名・サービスアイコン・アクティブ表示 |
| カラムエリア | 可変 | WebContentsViewを横並びに配置 |

### 4.2 レイアウト模式図

```
┌──────┬──────────────┬──────────────┬──────────────┬─────┐
│      │ 🐦 @acct1/X  │ 🦋 @acct2/BS │ 🧵 @acct3/Th │ ... │
│  🏠  ├──────────────┼──────────────┼──────────────┼─────┤
│  🔍  │              │              │              │     │
│  🔔  │  WebView     │  WebView     │  WebView     │ ... │
│  ✉️  │  x.com       │  bsky.app    │  threads.net │     │
│  🔖  │  (session1)  │  (session2)  │  (session3)  │     │
│  ──  │              │              │              │     │
│  👤1 │              │              │              │     │
│  👤2 │              │              │              │     │
│  👤3 │              │              │              │     │
│  ... │              │              │              │     │
│  ＋  │              │              │              │     │
└──────┴──────────────┴──────────────┴──────────────┴─────┘
```

### 4.3 カラム仕様

- **表示カラム数**: 1〜10（登録アカウント数に依存）
- **カラム幅**: `(アプリ幅 - 72px) / 表示カラム数` で均等分割
- **最小カラム幅**: 320px（これ以下は横スクロール）
- **アクティブカラム**: ヘッダーに青色ボーダー（`#1D9BF0`）でハイライト
- **カラム切り替え**: ヘッダークリック or サイドバーのアカウントアイコンクリック

### 4.4 カラムヘッダー仕様

各カラムのヘッダーに以下を表示する。

```
[ サービスアイコン ][ @username ] [🔔バッジ] [非表示] [×]
```

| 要素 | 説明 |
|------|------|
| サービスアイコン | X / Bluesky / Threads のアイコン |
| @username | ログイン後に自動取得。未ログインは「未ログイン」 |
| 🔔バッジ | 未読通知数（WebContentsのtitle変更を検知） |
| 非表示ボタン | カラムを一時的に非表示（セッションは保持） |
| ×ボタン | アカウント削除（確認ダイアログあり） |

---

## 5. サイドバー仕様

### 5.1 ナビゲーションメニュー（上段）

アクティブカラムのサービス種別（`service` フィールド）に応じてメニューラベルとURLを動的に切り替える。

| アイコン | メニュー名 | X | Bluesky | Threads |
|---------|-----------|---|---------|---------|
| 🏠 | ホーム | `/home` | `/` | `/` |
| 🔍 | 検索 | `/explore` | `/search` | `/search` |
| 🔔 | 通知 | `/notifications` | `/notifications` | `/activity` |
| ✉️ | メッセージ | `/messages` | `/messages` | ー（非対応） |
| 🔖 | ブックマーク | `/i/bookmarks` | `/profile/:u/lists` | `/saved` |
| 👤 | プロフィール | `/:username` | `/profile/:username` | `/@:username` |
| ✏️ | ポスト作成 | JS注入 | JS注入 | JS注入 |

> メッセージ非対応サービスではメニュー項目をグレーアウトして非活性表示する。

### 5.2 アカウントリスト（下段）

- 登録全アカウントのアバターアイコンを縦並びに表示（最大10件）
- サービスを識別できるよう、アイコン右下にサービスバッジを表示
- アクティブアカウントは青枠でハイライト
- 未ログインアカウントはグレーアイコンで表示
- 最下部に「＋」ボタンでアカウント追加

### 5.3 ポスト作成ボタン

- サイドバー最下部（＋ボタンの上）に固定配置
- アクティブカラムに対して `executeJavaScript` でポスト作成モーダルを開く
- サービスごとの実装:

```javascript
const POST_TRIGGER = {
  x:       `document.querySelector('[data-testid="tweetButtonInline"]')?.click()`,
  bluesky: `document.querySelector('[aria-label="New post"]')?.click()`,
  threads: `document.querySelector('[aria-label="Create"]')?.click()`,
}
```

> セレクターはサービスのUI変更で動作しなくなる可能性がある。定期的にメンテナンスが必要。

---

## 6. セッション管理仕様

### 6.1 セッション分離方式

```javascript
// サービスとアカウントIDの組み合わせでパーティションを一意化
const partition = `persist:${service}-${accountId}`
const ses = session.fromPartition(partition)
```

| パーティション例 | 説明 |
|----------------|------|
| `persist:x-uuid1` | X アカウント1（永続） |
| `persist:bluesky-uuid2` | Bluesky アカウント2（永続） |
| `persist:threads-uuid3` | Threads アカウント3（永続） |

### 6.2 セッションデータの保存場所

```
{appData}/multisnv-viewer/
└── sessions/
    ├── x-{id}/          Cookie・LocalStorage・HTTPキャッシュ等
    ├── bluesky-{id}/
    └── threads-{id}/
```

### 6.3 分離される要素

- Cookie（ログインセッショントークン）
- LocalStorage / SessionStorage
- IndexedDB
- HTTPキャッシュ
- Service Worker

### 6.4 セッション初期化フロー

```
アプリ起動
  │
  ├─ electron-store からアカウント設定を読み込む
  │
  ├─ 各アカウントに対して session.fromPartition() を呼び出す
  │
  ├─ セッションに User-Agent を設定（通常ブラウザと同一）
  │
  ├─ WebContentsView を生成し、対応セッションを割り当てる
  │
  └─ ログイン済み → {homeUrl} をロード
     未ログイン  → {loginUrl} をロード
```

### 6.5 ログイン完了の検知

`did-navigate` イベントで各サービスのホームURLへの遷移を検知し、アカウント情報を自動取得する。

```javascript
const LOGIN_SUCCESS_PATH = {
  x:       '/home',
  bluesky: '/',
  threads: '/',
}
```

---

## 7. アカウント管理仕様

### 7.1 アカウント設定データ構造

```typescript
interface Account {
  id:          string        // UUID（セッションパーティション名に使用）
  service:     'x' | 'bluesky' | 'threads'
  displayName: string        // 任意の表示名
  username:    string | null // @以降のユーザー名（ログイン後に自動取得）
  avatarUrl:   string | null // プロフィール画像URL（ログイン後に自動取得）
  order:        number       // カラム表示順（0始まり）
  isVisible:   boolean       // カラムの表示/非表示フラグ
  createdAt:   string        // ISO 8601
}
```

### 7.2 アカウント操作

| 操作 | トリガー | 処理 |
|------|---------|------|
| 追加 | サイドバー「＋」ボタン | サービス選択ダイアログ → 新カラム生成 → ログイン画面表示 |
| 削除 | カラムヘッダー「×」 | 確認ダイアログ → セッションデータ削除 → カラム除去 |
| 並び替え | カラムヘッダー D&D | electron-store に新しい order を保存 |
| 非表示 | カラムヘッダー「目」 | `isVisible: false`（セッションは保持） |

### 7.3 サービス選択ダイアログ

アカウント追加時に以下のサービス選択UIを表示する。

```
┌─────────────────────────────┐
│  アカウントを追加            │
│                             │
│  [🐦 X (Twitter)]           │
│  [🦋 Bluesky    ]           │
│  [🧵 Threads    ]           │
│                             │
│              [キャンセル]    │
└─────────────────────────────┘
```

---

## 8. IPC通信仕様

### 8.1 Renderer → Main

| チャネル | パラメータ | 処理内容 |
|---------|-----------|---------|
| `navigate` | `{accountId, path}` | 指定アカウントのWebViewをpathへ遷移 |
| `set-active` | `{accountId}` | アクティブカラムを変更 |
| `add-account` | `{service}` | 新規アカウントカラムを追加 |
| `remove-account` | `{accountId}` | 指定アカウントを削除 |
| `reorder-accounts` | `{order: string[]}` | カラム表示順を更新 |
| `toggle-visibility` | `{accountId, isVisible}` | カラムの表示/非表示切り替え |
| `execute-js` | `{accountId, code}` | 指定WebViewでJS実行（固定文字列のみ） |
| `get-accounts` | `{}` | アカウント一覧を返す（invoke） |

### 8.2 Main → Renderer

| チャネル | パラメータ | 内容 |
|---------|-----------|------|
| `account-updated` | `{account}` | アカウント情報更新通知（アイコン等） |
| `active-changed` | `{accountId}` | アクティブカラム変更通知 |
| `nav-state-changed` | `{accountId, url, canGoBack, canGoForward}` | ナビゲーション状態変更 |
| `notification-badge` | `{accountId, count}` | 未読通知数更新 |

---

## 9. ディレクトリ構成

```
multisnv-viewer/
├── package.json
├── .nvmrc                        # Node.jsバージョン固定
├── main/
│   ├── index.js                  # メインプロセスエントリポイント
│   ├── windowManager.js          # BrowserWindow・WebContentsView管理
│   ├── sessionManager.js         # セッション生成・分離・safeStorage管理
│   ├── accountStore.js           # electron-store によるアカウント永続化
│   └── ipcHandlers.js            # IPCイベントハンドラー
├── renderer/
│   ├── index.html                # メインウィンドウHTML
│   ├── sidebar.js                # サイドバーUI制御
│   ├── columnHeader.js           # カラムヘッダーUI制御
│   └── styles/
│       ├── main.css
│       └── sidebar.css
├── preload/
│   └── preload.js                # contextBridge でAPI公開
├── config/
│   └── services.js               # NAV_MAP・POST_TRIGGER等のサービス定義
└── assets/
    └── icons/                    # サービスアイコン・アプリアイコン
```

---

## 10. 開発フェーズ

### フェーズ概要

| フェーズ | 名称 | 期間目安 | 担当 | 主な成果物 |
|---------|------|---------|------|-----------|
| Phase 1 | 環境構築・基盤 | 1〜2週 | 全員 | 動作するElectronスケルトン |
| Phase 2 | セッション分離 | 1〜2週 | バックエンド担当 | 3サービス×複数アカウント分離確認 |
| Phase 3 | UI実装 | 2〜3週 | フロントエンド担当 | サイドバー・カラムUI |
| Phase 4 | ナビゲーション | 1〜2週 | 全員 | メニュー操作・IPC通信 |
| Phase 5 | アカウント管理 | 1〜2週 | バックエンド担当 | 追加/削除/並び替え |
| Phase 6 | 品質・リリース | 2〜3週 | 全員 | 署名済みインストーラー |

---

### Phase 1　環境構築・基盤

**目標**
開発環境を統一し、Electronアプリとして複数のWebContentsViewを並べて表示できる最小構成を確立する。

**タスク**
- Node.js / npmバージョンをチーム内で統一（`.nvmrc` で管理）
- Electronプロジェクト初期化（electron-builder設定）
- メインウィンドウ（BrowserWindow）の生成と基本レイアウト確認
- WebContentsViewを3本並べてX・Bluesky・Threadsを表示するプロトタイプ作成
- ESLint / Prettier 設定・CIパイプライン（GitHub Actions等）の構築
- Gitブランチ戦略の合意（`main` / `develop` / `feature/*`）

**完了基準**
- チーム全員がローカルでアプリをビルド・起動できる
- WebContentsView 3本がそれぞれ独立して表示される
- PRを出すとCIが自動でlint / buildチェックを実行する

**担当分担**
- リード: プロジェクト初期化・CI構築
- 全員: ローカル環境セットアップ・動作確認

---

### Phase 2　セッション分離・永続化

**目標**
3サービス × 最大10アカウント分のセッションを完全に分離し、再起動後もログイン状態が維持されることを確認する。セキュリティ要件もこのフェーズで実装する。

**タスク**
- `sessionManager.js` 実装: `session.fromPartition('persist:{service}-{id}')` でセッション生成
- WebContentsViewへのセッション割り当てロジック実装
- 異なるサービス・アカウント間でCookie・LocalStorageが共有されないことを検証
- `safeStorage` APIによる認証トークンの暗号化・復号ロジック実装
- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` の設定
- `setWindowOpenHandler` による外部リンクのブラウザ委譲実装
- `electron-store` 導入・アカウント設定スキーマ定義
- 再起動後のセッション復元フローの実装とテスト

**完了基準**
- X・Bluesky・Threadsのアカウントをそれぞれ別セッションでログインできる
- アプリ再起動後、全アカウントのログイン状態が維持される
- `safeStorage` による暗号化がDevToolsで確認できる

**担当分担**
- バックエンド担当: sessionManager / accountStore / safeStorage実装
- 全員: セキュリティ設定レビュー・分離テスト

---

### Phase 3　UI実装（サイドバー・カラム）

**目標**
左サイドバー（ナビゲーションメニュー＋アカウントリスト）とカラムヘッダーを実装し、アクティブカラムの視覚的フィードバックを完成させる。

**タスク**
- サイドバーHTMLとCSS実装（固定幅72px）
- ナビゲーションメニュー項目の配置（ホーム・検索・通知・DM・ブックマーク・プロフィール・ポスト）
- アクティブカラムのサービスに応じたメニューの動的切り替え（`NAV_MAP` 参照）
- 非対応メニュー項目のグレーアウト表示（例: ThreadsのDM）
- アカウントアイコンリスト実装（アバター画像 + サービスバッジ）
- カラムヘッダーコンポーネント実装（アカウント名・サービスアイコン・バッジ・非表示・閉じる）
- アクティブカラムの選択状態管理（クリックで切り替え・青枠ハイライト）
- `preload.js` で `contextBridge` を使ったIPC APIの公開
- カラム幅の均等分割ロジックとウィンドウリサイズへの追従

**完了基準**
- サイドバーのメニューが、アクティブカラムのサービスに応じて正しく切り替わる
- カラムヘッダーにサービスアイコンとアカウント名が表示される
- ウィンドウをリサイズするとカラム幅が動的に追従する

**担当分担**
- フロントエンド担当: サイドバーUI・カラムヘッダー・CSS
- バックエンド担当: preload.js / setBounds動的更新ロジック

---

### Phase 4　ナビゲーション・IPC通信

**目標**
サイドバーのメニュークリックがアクティブなWebContentsViewに正しく反映されるIPC通信を完成させる。

**タスク**
- `ipcHandlers.js` 実装: `navigate` / `set-active` / `execute-js` 等の全チャネル
- メニュークリック → `ipcRenderer.send` → `ipcMain` → `webContents.loadURL` のフロー実装
- ポスト作成ボタンの `executeJavaScript` 実装（`POST_TRIGGER` 定数を使用、固定文字列のみ）
- `nav-state-changed` イベントによる戻る/進むボタン状態の同期
- アカウントリストアイコンクリック → アクティブカラム切り替え連携
- ログイン完了検知（`did-navigate` で各サービスのホームパスを検知）
- ログイン完了後のアカウント情報自動取得（username / avatarUrl）
- IPC通信の全チャネルについて手動確認テスト

**完了基準**
- サイドバーの「ホーム」クリックでアクティブカラムが各サービスのホームに遷移する
- 別カラムをアクティブにして同じメニューをクリックすると、そちらが遷移する
- ログイン完了後にアバターとサービスバッジがサイドバーに反映される

**担当分担**
- バックエンド担当: ipcHandlers / navigate / execute-js ロジック
- フロントエンド担当: sidebar.js のイベントハンドラー・状態反映

---

### Phase 5　アカウント管理・UX改善

**目標**
アカウントの追加・削除・並び替えを実装し、実用レベルのUXに仕上げる。

**タスク**
- アカウント追加フロー: サービス選択ダイアログ → 新カラム生成 → ログイン画面表示
- アカウント削除フロー: 確認ダイアログ → セッションデータ削除 → カラム除去
- カラム並び替え: ドラッグ&ドロップによる順序変更（electron-storeへ保存）
- カラム表示/非表示トグル（セッションは保持したまま非表示）
- ウィンドウサイズ・位置の永続化（再起動後も復元）
- キーボードショートカット実装（`Cmd/Ctrl+数字` でアクティブカラム切り替え）
- 未読通知バッジ: `page-title-updated` イベントで数値を取得・カラムヘッダーに表示
- ダークモード対応（OSテーマ設定に追従）
- 【Phase4繰越・要否判断】IPC状態の per-window カプセル化: `ipcHandlers.ts` の module-scope な状態（`lastGoodProfile` / `lastEmitted` / `emittingColumns` / `rerunRequested` / `currentWin` / `pollTimer`）は現状、単一ウィンドウ前提＋`currentWin` 同一性ガードで対応。**真のマルチウィンドウ（複数メインウィンドウ）を実装する場合のみ**、これらを `setupIpcHandlers` 内ローカル化（または状態オブジェクト注入）＋`event.sender` ベースのルーティングへ移行する。マルチウィンドウを採用しない方針なら現状維持で対応不要。※Phase4 コードレビューで複数回（13/14/16/19巡目）指摘・YAGNI判断で保留した項目。

**完了基準**
- 3サービス混在で計10アカウントを追加・削除・並び替えできる
- ドラッグ&ドロップ後にアプリを再起動しても順序が保持される
- `Cmd/Ctrl+1〜0` でカラムが切り替わる

**担当分担**
- フロントエンド担当: ドラッグ&ドロップUI・ダークモード・バッジ表示
- バックエンド担当: アカウント追加/削除ロジック・ショートカット登録

---

### Phase 6　品質保証・パッケージング・リリース

**目標**
セキュリティチェックリストの全項目をクリアし、Windows / macOS / Linux 向けの署名済みインストーラーを作成・配布する。

**タスク**
- 第11章セキュリティチェックリスト全項目の確認・修正
- 本番ビルドでの `console.log` 無効化とログサニタイズ
- electron-builder によるプラットフォーム別ビルド設定
  - Windows: NSSIインストーラー・EV証明書によるコード署名
  - macOS: DMG・Developer ID 証明書・公証（Notarization）
  - Linux: AppImage / deb パッケージ
- パフォーマンス計測: 起動時間・メモリ使用量・カラムスクロールfps
- 10アカウント同時起動での負荷テスト
- アップデート機構（electron-updater）と署名検証の有効化
- README / インストール手順書の作成
- 各OS・解像度（1080p / 4K / MacBook Retina）での表示確認

**完了基準**
- セキュリティチェックリストの必須項目がすべて ✅
- 各OS向けインストーラーが正常にインストール・起動できる
- 起動時間5秒以内・10アカウント時メモリ2.5GB以下
- コード署名エラーなしでインストール可能

**担当分担**
- リード: electron-builder設定・コード署名・リリース管理
- 全員: OS別動作確認・セキュリティチェック

---

### フェーズ間レビュー

各フェーズ完了時に以下を実施してから次フェーズに移行する。

| レビュー項目 | 内容 |
|------------|------|
| 完了基準確認 | そのフェーズの完了基準を全員でチェックし、未達項目を次フェーズのバックログに追加 |
| コードレビュー | PRを通じたコードレビューを実施。セキュリティ設定は必須確認 |
| 動作確認 | 全員のローカル環境で動作することを確認 |
| ドキュメント更新 | 仕様書との乖離が発生していれば本書を更新 |
| リスク共有 | 次フェーズで懸念される技術的リスクをチーム内で共有・対策を検討 |

---

## 11. セキュリティ仕様

### 11.1 ローカル保存データの全体像

| データ種別 | 保存場所 | 重要度 | 内容 |
|-----------|---------|--------|------|
| Cookies | `sessions/{service}-{id}/` | ★★★ 最重要 | 認証トークン（auth_token等） |
| LocalStorage | `sessions/{service}-{id}/` | ★★ | UIの設定・一時データ |
| IndexedDB | `sessions/{service}-{id}/` | ★ | タイムラインキャッシュ等 |
| HTTPキャッシュ | `sessions/{service}-{id}/` | ★ | 画像・JS・CSSのキャッシュ |
| Service Worker | `sessions/{service}-{id}/` | ★ | オフライン対応スクリプト |
| アカウント設定 | `electron-store (JSON)` | ★★ | ユーザー名・アバターURL・カラム設定 |

### 11.2 リスクと対策

#### 🔴 リスク1: セッションデータの平文保存

認証トークンを含むCookieがデフォルトではディスクに平文で保存される。10アカウント分が単一アプリに集中しているため、漏洩時の被害が最大化する。

**対策（優先度：高）**
- Electron組み込みの `safeStorage` APIで認証トークンを暗号化して別管理する
  - macOS: Keychain、Windows: DPAPI、Linux: Secret Serviceと統合
  - 追加ライブラリ不要
- アプリ終了時に機密性の低いキャッシュを自動削除するオプションを提供

#### 🟡 リスク2: contextIsolation / nodeIntegration の設定ミス

WebContentsView内で `nodeIntegration: true` にすると、SNSサイト上のXSSや悪意あるスクリプトがNode.js APIにアクセスできる。

**対策（必須設定）**
```javascript
// すべてのWebContentsViewに適用
{
  contextIsolation: true,
  nodeIntegration:  false,
  sandbox:          true,
  allowRunningInsecureContent: false,
}
```

#### 🟡 リスク3: executeJavaScript の乱用

ポスト作成等で `executeJavaScript` を使用する際、引数にユーザー入力が混入するとXSS相当のリスクとなる。

**対策**
- 実行するコードは `config/services.js` にハードコードされた固定文字列のみ
- アカウント名・ユーザー入力値を動的にコード文字列へ埋め込まない
- PRレビュー時に `executeJavaScript` の引数を必ず確認する

#### 🟡 リスク4: 外部リンクの不正処理

SNSサイト内のリンククリックで `new-window` イベントが発生し、設定によってはアプリ内で任意のサイトが開く可能性がある。

**対策**
```javascript
// ⚠️ url.includes(d) は部分文字列一致のため evil-x.com.attacker.example 等を
//    誤許可する。厳密なホスト名一致で判定し、かつ「そのカラム自身のサービスの
//    同一ドメイン」のみアプリ内で開く（他サービス含めそれ以外は外部ブラウザへ）。
webContentsView.webContents.setWindowOpenHandler(({ url }) => {
  const ownDomain = SERVICE_DOMAIN[account.service] // 例: 'x.com'
  let host
  try { host = new URL(url).hostname } catch { return { action: 'deny' } }
  const sameService = host === ownDomain || host.endsWith('.' + ownDomain)
  if (sameService) {
    return { action: 'allow' }
  }
  shell.openExternal(url)
  return { action: 'deny' }
})
```

#### 🟢 リスク5: アップデートファイルの完全性

electron-updater を使用する場合、アップデートファイルの改ざん検証が必要。

**対策**
- コード署名（Windows: EV証明書 / macOS: Developer ID）を必ず実施
- electron-updater の署名検証機能を有効にする

#### 🟢 リスク6: 開発時のログ漏洩

開発中に `console.log` で認証トークン・Cookieを出力してしまうリスク。

**対策**
- 本番ビルドで `console.log` / `console.debug` を無効化
- ログ出力は専用ライブラリ経由とし、機密情報のサニタイズルールを設ける

### 11.3 セキュリティ設定チェックリスト

| # | チェック項目 | 優先度 | 担当 |
|---|------------|--------|------|
| 1 | `safeStorage` APIによる認証トークンの暗号化を実装している | 必須 | 実装者 |
| 2 | `contextIsolation: true` が全WebContentsViewに設定されている | 必須 | 実装者 |
| 3 | `nodeIntegration: false` が全WebContentsViewに設定されている | 必須 | 実装者 |
| 4 | `sandbox: true` が全WebContentsViewに設定されている | 必須 | 実装者 |
| 5 | `setWindowOpenHandler` で外部リンクをブラウザに委譲している | 必須 | 実装者 |
| 6 | `executeJavaScript` の引数が固定文字列のみである | 必須 | レビュアー |
| 7 | `allowRunningInsecureContent: false` が設定されている | 必須 | 実装者 |
| 8 | 本番ビルドで `console.log` が無効化されている | 推奨 | 実装者 |
| 9 | コード署名が実施されている | 推奨 | リリース担当 |

---

## 12. 非機能要件

### 12.1 パフォーマンス

| 指標 | 目標値 |
|------|--------|
| アプリ起動時間 | 5秒以内（10アカウント設定時） |
| メモリ使用量 | アカウントあたり概算150〜250MB |
| 10アカウント時の合計メモリ | 2.5GB以下 |
| カラムスクロール | 60fps以上 |

### 12.2 対応OS

- Windows 10 / 11（x64）
- macOS 12以降（Intel / Apple Silicon）
- Ubuntu 20.04以降 / Debian 11以降

### 12.3 ウィンドウ

- 最小ウィンドウサイズ: 800px × 600px
- 初期ウィンドウサイズ: 1400px × 900px
- ウィンドウサイズ・位置は再起動後も保持

---

## 13. 注意事項・制約

### 13.1 各サービス利用規約

| サービス | 禁止事項 | 閲覧のみの場合 |
|---------|---------|--------------|
| X (Twitter) | 自動投稿・スクレイピング・API不正利用 | ✅ 問題なし |
| Bluesky | 自動スパム・ハラスメント | ✅ 問題なし |
| Threads (Meta) | スクレイピング・自動操作 | ✅ 問題なし |

本ツールは通常のブラウザ利用と同等のWebViewを使用する。自動操作・スクレイピング機能は実装しない。

### 13.2 既知の制限

- WebContentsView はChromiumベースのため相応のメモリを消費する（10アカウントで推定1.5〜2.5GB）
- ポスト作成ボタンはSNSサービス側のUI変更（`data-testid` / `aria-label` 属性等）により動作しなくなる可能性がある。定期的なメンテナンスが必要
- 各SNSサービスが仕様変更した場合、`NAV_MAP` の更新が必要

### 13.3 主要依存パッケージ

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| `electron` | ^29.x | メインフレームワーク（WebContentsView対応） |
| `electron-store` | ^10.x | 設定永続化 |
| `electron-builder` | ^24.x | パッケージング・インストーラー生成 |
| `electron-updater` | ^6.x | 自動アップデート |

---

## 14. 確定事項（共通認識セッション v1.1）

以下は設計レビューで確定した事項であり、**本書の旧記述と矛盾する場合は本章を優先する**。用語の正準定義は `CONTEXT.md`、判断の背景は `docs/adr/` を参照。

| # | 論点 | 確定内容 | 旧記述との関係 |
|---|------|---------|--------------|
| 1 | 中核エンティティ | **Account = Column = Session を厳密に 1:1:1**。「非表示」は WebContentsView を破棄し Session（ディスク）は保持。再表示時に再生成しログイン維持 | 7.x / 4.x を明確化 |
| 2A | ログイン検知 | ホームパス到達ではなく**認証 Cookie の有無で判定**（`session.cookies.get()`）。Bluesky/Threads の `'/'` 誤検知を回避 | 6.5 の `LOGIN_SUCCESS_PATH` を置換 |
| 2B | username/avatar | **ログイン成功時に DOM から限定取得（ベストエフォート）**。失敗時は `displayName` で代替。→ ADR-0001 | 13.1 を緩和（下記#13.1' 参照） |
| 3 | safeStorage | **認証トークンの別管理は廃止**し Chromium/OS 暗号化に委譲。`safeStorage` は将来 electron-store の機微値用に枠のみ。→ ADR-0002 | 11.2 リスク1・11.3 #1・Phase2 完了基準を置換 |
| 4 | カラム幅 | **最小320px を絶対優先**＝`max(320, (アプリ幅-72)/カラム数)`。収まらなければ横スクロール。「均等分割」は収まる範囲での副次ルール | 4.3 を明確化 |
| 4' | Electron | 依存を **EOL の `^29` から現行サポート版へバンプ**（WebContentsView API はそのまま利用可） | 13.3 を更新 |
| 5 | 外部リンク | **厳密ホスト名一致**＋**自サービスの同一ドメインのみアプリ内**、他は `shell.openExternal`。→ 11.2 リスク4 のコードを修正済み | 11.2 リスク4・11.3 #5 を置換 |
| 6 | 通知 | バッジ＝**title 先頭 `(\d+)` のベストエフォート**（出せないサービスは非表示）。デスクトップ通知＝**Web Notification API を許可し OS ネイティブ通知へ委譲**（独自生成しない） | 4.4・5.x・1.3 を明確化 |
| 7 | User-Agent | **`process.versions.chrome` から動的生成した素の Chrome デスクトップ UA** を全 Session 共通設定（`Electron/*`・アプリ名トークンを除去） | 6.4 を具体化 |
| 8 | ポスト作成 | **compose/intent URL 遷移を第一選択**（X:`/compose/post`、Bluesky:`/intent/compose`、Threads:`/intent/post`）。`executeJavaScript` は v1.0 実質排除（フォールバック専用） | 5.3 の `POST_TRIGGER`・11.2 リスク3・11.3 #6 を強化 |
| 9 | 追加ライフサイクル | **サービス選択時に Account を即生成・永続化**（partition 確定で 2FA 途中の再起動でも継続）。未ログインは UI で明示し即削除可。**カラム0本時は中央プレースホルダ** | 7.2 を明確化 |
| 10 | アカウント上限 | **ソフト上限**（上限なし）。合計が10を超える追加時に**一度だけ非ブロッキング警告**。ショートカット `Cmd/Ctrl+1〜0` は1〜10のみ。11本目以降はクリック／横スクロール。閾値10は定数化 | 1.3・4.3 を更新。下記#12 NFR 参照 |
| 11 | プロフィール遷移 | `username` 未取得時は**メニューをグレーアウト**、取得成功で活性化 | 5.1 NAV_MAP を補足 |
| 12 | 異常系（v1.0 含む） | `render-process-gone`：エラーオーバーレイ＋**1回だけ自動再読み込み**。`did-fail-load`（致命）：オーバーレイ＋手動再読み込み。`unresponsive`：待つ／再読み込み提示。いずれも Session は破棄しない | 新規（旧書になし） |
| 12' | 非機能要件 | パフォーマンス目標（起動5秒・メモリ2.5GB 等）は**「10アカウント時点の目標」**と位置づけ、超過分はベストエフォート（保証外） | 12.1 を明確化 |
| 13.1' | 利用規約 | 「自動投稿・自動操作・スクレイピングは実装しない。**ただし表示用メタ情報（username/avatar）の DOM 読み取りは行う**」に改める。→ ADR-0001 | 13.1 を緩和 |
| 15 | 開発スタック | **Vite + TypeScript**。ボイラープレートは **electron-vite（`@quick-start/electron`）**。renderer 外枠UIは **React + TS**（重い描画はネイティブ WebContentsView が担い、React は外枠のみ）。パッケージングは electron-builder 継続。→ ADR-0003 | §3.1「レンダラー: Vanilla JS」・§9 を読み替え |
| 16 | 自動更新 | **electron-updater は macOS（＋将来 Linux AppImage）限定**。GitHub Releases（`publish: 'github'`）から、パッケージ済みビルドのみ有効、起動時＋4時間間隔でチェック→DL→「再起動して更新」、`autoInstallOnAppQuit: true`、署名検証維持。**Windows の更新は Microsoft Store が処理（electron-updater 対象外）**。→ ADR-0004 / ADR-0005 | §13.3・Phase6・リスク5 を具体化 |
| 17 | リリースCI・配信 | **`release` ブランチ push で GitHub Actions が mac/Windows をビルド**。**macOS=Developer ID署名＋公証→GitHub Releases**、**Windows=Microsoft Store（MSIX、Store署名・Store更新）**。バージョンは package.json。Store 提出は別ステップ（Partner Center 手動 or msstore CLI）。MSIX のサンドボックスとセッション保存パス(§6.2)は実装時要検証。→ ADR-0005 | Phase1 CI・Phase6 を具体化 |

---

*MultiSNS Viewer 設計仕様書 v1.1 — 2026年6月（共通認識セッション反映）*
