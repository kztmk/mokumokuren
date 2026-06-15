# 認証トークンの safeStorage 別管理を行わず、Chromium / OS の暗号化に委譲する

/ status: accepted

認証トークン（auth_token 等）を Cookie ストアから抜き取り `safeStorage` で別管理する仕組み（仕様書 11.2 リスク1 の当初案）は実装せず、トークンは Chromium が管理する partition の Cookie ストアに委ね、ディスク上の保護は Chromium の暗号化（OS キーチェーン連携）と OS のユーザー領域・ディスク暗号化（FileVault / BitLocker）に依存する。

## 背景・代替案

- 認証トークンは SNS サイト側が `Set-Cookie` で発行し、アプリのコードは一切触れない。これを `safeStorage` で別管理するには、Cookie ストアからの手動抽出と再注入が必要で、極めて壊れやすく Chromium のセッション更新と競合する（実質、自前ブラウザの再発明）。
- また当初の完了基準「safeStorage 暗号化を DevTools で確認」も、Cookie は DevTools の Application タブで平文表示されるため成立しない。
- **採用案**: トークン別管理は廃止。`safeStorage` は「将来 electron-store に機微な値を書く場合の暗号化手段」として枠のみ残す（現状は対象なし）。

## 帰結

- これにより「必須」セキュリティ項目（チェックリスト#1）を1つ降格する。非機能要件に「OS アカウント分離＋ディスク全体暗号化を前提とする」を明記する。
- contextIsolation / nodeIntegration / sandbox / setWindowOpenHandler 等の他の必須項目は維持。
