# 自動更新は electron-updater + GitHub Releases で行う

/ status: accepted

アプリの自動更新を `electron-updater` で実装し、配信フィードに **GitHub Releases**（electron-builder の `publish: 'github'`）を用いる。リリースは Phase1 で構築する GitHub Actions からタグ push で生成する。

## 背景・代替案

- **GitHub Releases（採用）**: 無料・設定最小・CI(GitHub Actions) と一体化。プライベートリポジトリでも `GH_TOKEN` で配信可能。
- **S3 / 互換ストレージ（R2 等）**: ダウンロード統計・アクセス制御を自社管理できるが、設定・費用・運用が増える。
- **generic（自前 HTTP）**: 最も柔軟だがホスティング・HTTPS・整合性管理を全て自前で負う。

## 制約（OSごと）

- **macOS**: 自動更新には Developer ID 署名＋公証が**必須**（未署名は更新不可）。Phase6 の署名と不可分。
- **Windows**: コード署名必須（改ざん検証・SmartScreen）。リスク5 と対応。
- **Linux**: **AppImage は自動更新可**、**deb（apt）は自動更新非対応** → deb は手動更新と割り切る（§12.2）。

## 帰結（実装方針）

- 自動更新は**パッケージ済みビルドのみ**有効（開発時は無効）。
- 起動時＋定期（既定4時間間隔）でチェック → バックグラウンドDL → 完了を renderer に通知し、ユーザーが「再起動して更新」を押すと `quitAndInstall`。`autoInstallOnAppQuit: true` で無視されても次回終了時に適用。
- 署名検証（electron-updater 既定の検証）を有効に保つ（リスク5・チェックリスト#9）。
- §13.3 の `electron-updater ^6.x`・Phase6 の更新機構タスクと整合。

## 改訂（ADR-0005 による）

Windows を Microsoft Store（MSIX）で配信する決定により、**electron-updater のスコープは macOS（＋将来 Linux AppImage）に限定**する。**Windows の更新は Microsoft Store が処理**し、electron-updater は使わない。GitHub Releases への publish は macOS 版が対象。
