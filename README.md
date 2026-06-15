# mokumokuren — MultiSNS Viewer

X / Bluesky / Threads を 1 つのデスクトップアプリで同時閲覧するマルチSNSビューア。
Electron + WebContentsView + React (electron-vite) 構成。

## 環境

| ツール | バージョン |
|--------|------------|
| Node.js | 24 LTS (.nvmrc 参照) |
| Electron | 42.0.0 |
| electron-vite | 5.0.0 |
| TypeScript | ~5.9 |

## セットアップ

```bash
nvm use 24
npm install
```

### Electron バイナリ手動補完

macOS arm64 で `npm install` 後に `node_modules/electron/path.txt` が生成されない場合、
`npm run dev` が `Error: Electron uninstall` で失敗することがある。
その場合は Electron installer を明示実行する。

```bash
ELECTRON_CACHE=~/.cache/electron node node_modules/electron/install.js
test -f node_modules/electron/path.txt
```

## 起動

```bash
nvm use 24
npm run dev
```

## ビルド・Lint

```bash
npm run build
npm run lint
```

## ディレクトリ構成

仕様書 §9 の構成は ADR-0003 により React + TypeScript / electron-vite 構成へ読み替える。
現行構成は以下の通り。

```text
mokumokuren/
├── src/
│   ├── main/          # Electron main process / WebContentsView 管理
│   ├── preload/       # Preload scripts (contextBridge)
│   └── renderer/      # React renderer (外枠UI)
├── resources/         # アイコン等静的リソース
├── .github/
│   └── workflows/
│       └── ci.yml     # GitHub Actions (lint + build)
├── docs/
│   └── adr/           # Architecture Decision Records
├── .nvmrc             # Node 24 固定
└── electron.vite.config.ts
```

## ブランチ戦略

| ブランチ | 用途 |
|----------|------|
| `main` | 安定版・リリース |
| `develop` | 開発統合ブランチ |
| `feature/*` | 機能開発 |

PR フロー: `feature/*` → `develop` → `main`

## セキュリティ

全 WebContentsView に以下を強制する。

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `allowRunningInsecureContent: false`

## 推奨IDE

- VSCode
- ESLint extension
- Prettier extension
