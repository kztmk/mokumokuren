# renderer の外枠UIに React + TypeScript を採用する（仕様の vanilla 方針から逸脱）

/ status: accepted

renderer（サイドバー・カラムヘッダー・各種ダイアログ等の「外枠UI」）を、仕様書当初の vanilla JS ではなく **React + TypeScript** で実装する。ボイラープレートは electron-vite の `react-ts` テンプレートを用い、ビルド/パッケージングは electron-builder を継続使用する。

## 背景・代替案

renderer はネイティブの WebContentsView（main プロセス管理）を描画せず、外枠UIのみを描く小さな面である。しかしその外枠は状態が濃く、IPC イベント（`account-updated` / `active-changed` / `nav-state-changed` / `notification-badge`）で外部から状態が流入し、アクティブカラムに応じたナビメニュー切替・アカウントリストの追加/削除/並び替え・バッジ更新などを同期する必要がある。

- **Vanilla TS（仕様当初案）**: 依存最小・セキュリティ監査対象が少ない。しかし状態同期を手続き的に DOM 操作で書くことになり、「各操作は正しいのに最終状態がズレる」系のバグを誘発しやすい。
- **Svelte / Solid + TS**: この規模には記述量が少なく軽量だが、ドラッグ&ドロップ等のエコシステムが React ほど厚くない。
- **React + TS（採用）**: イベント駆動の状態同期に強く、`dnd-kit` 等エコシステムが厚い。デスクトップアプリゆえバンドルサイズの不利は無視できる。

## 帰結

- 仕様書 §3.1（レンダラー: Vanilla JS）・§9（`renderer/*.js`）は React + TS 構成に読み替える（§14 に反映）。
- セキュリティ必須項目（contextIsolation / sandbox / nodeIntegration:false / preload の contextBridge）は据え置き。React 採用はこれらに影響しない。
- 重い描画は引き続きネイティブ WebContentsView が担い、React は外枠のみを描く。
