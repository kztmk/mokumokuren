# MultiSNS Viewer

複数のSNS（X / Bluesky / Threads ほか）を、アカウントごとに完全分離したブラウザセッションで同時閲覧する Electron デスクトップビューアー。この文書はプロジェクト固有の用語集であり、実装仕様ではない。

## Language

**Account（アカウント）**:
ユーザーがアプリに登録する単位。1つの Account は 1つの Column と 1つの Session に厳密に 1:1:1 で対応する。`service` と UUID(`id`) を持つ。
_Avoid_: ログイン, ユーザー, プロファイル

**Column（カラム）**:
1つの Account を表示する縦長の表示領域。WebContentsView 1本に対応する。
_Avoid_: ペイン, タブ, ビュー

**Session（セッション）**:
Account ごとに分離された永続ブラウザ状態（Cookie・LocalStorage・IndexedDB・キャッシュ等）。`persist:{service}-{id}` パーティションでディスクに永続化される。
_Avoid_: プロファイル

**Service（サービス）**:
SNS の種別（`x` / `bluesky` / `threads`）。Account は必ず1つの Service に属する。Service ごとに NAV_MAP・POST_TRIGGER 等の振る舞いが定義される。
_Avoid_: プラットフォーム, SNS

**Hidden（非表示）**:
Column を画面から消した状態（`isVisible: false`）。WebContentsView は破棄されるが Session（ディスク）は保持されるため、再表示時はログイン状態を維持したまま再生成される。
_Avoid_: 最小化, クローズ

**Active Column（アクティブカラム）**:
サイドバーのナビゲーション操作・ポスト作成の対象となる、現在選択中の Column。常に最大1つ。
