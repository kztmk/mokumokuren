# リリースCIと配信モデル（release ブランチ push で mac=GitHub Releases / Windows=Microsoft Store）

/ status: accepted

GitHub の **`release` ブランチへの push** をトリガーに、GitHub Actions で macOS 版と Windows 版をビルドする。配信は OS ごとに分岐する。

- **macOS**: Developer ID 署名＋公証 → **GitHub Releases** に publish（electron-builder `publish: 'github'`）。electron-updater による自動更新が有効。
- **Windows**: **Microsoft Store**（MSIX/AppX、electron-builder `appx` ターゲット）。署名は Store が付与し、更新も Store が処理する（electron-updater は使わない）。

バージョンは `package.json` の `version` を真実の源とする。

## 背景・代替案

- Windows を NSIS+EV 証明書で GitHub Releases に出して全OS で electron-updater 統一する案もあったが、ユーザー方針により Windows は Store 配信（自前 EV 証明書不要、署名は Store 任せ）を採用。代償として Windows の自動更新は Store 依存になる（ADR-0004 を改訂）。
- トリガーはタグ push ではなく `release` ブランチ push。ワークフローは `package.json` の version を用いて GitHub Release を作成/publish する。

## 制約・前提

- **CI は Windows の `.msixupload` をビルドするが、Store への提出・審査は別ステップ**（Partner Center 手動 or `msstore` CLI / StoreBroker で自動化）。
- MSIX には Partner Center で予約した **Publisher / Identity Name** が必要で、CI に値（Secrets/変数）として渡す。Partner Center 開発者登録が前提。
- macOS ビルドには Apple Developer 登録と、CI Secrets への証明書・公証資格情報が必要。
- 必要 Secrets（想定）:
  - mac: `CSC_LINK`(base64 .p12) / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` / `GH_TOKEN`
  - win: MSIX 用 `publisher` / `identityName`（＋Store 提出を自動化する場合は Partner Center / Azure AD 資格情報）
- MSIX は AppContainer サンドボックスで動作するため、§6.2 のセッション保存パスが仮想化される点は実装時に要検証。

## 帰結

- ワークフロー `.github/workflows/release.yml`：`on: push: branches: [release]`。`macos-latest` ジョブ（mac ビルド＋GitHub Releases publish）と `windows-latest` ジョブ（MSIX ビルド＋アーティファクト/Store 提出）の2本立て。
- §12.2 の Linux（AppImage/deb）は本パイプラインの対象外（将来追加）。
