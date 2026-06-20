# リリース手順 (Phase 6)

`release` ブランチへ push すると GitHub Actions（`.github/workflows/release.yml`）が起動し、
配布物をビルドします。

| プラットフォーム | 成果物 | 署名 | 配布 |
| --- | --- | --- | --- |
| **macOS** | `.dmg`（arm64 / x64）, `.zip` | Developer ID 署名 + 公証(Notarization) | **GitHub Releases**（下書きを publish して案内） |
| **Windows** | `.appx`（MSIX） | **Microsoft Store がアップロード時に署名**（CIでは署名しない） | **Microsoft Store**（Partner Center へ提出 → ストアURLを案内） |

> Linux はリリースCIの対象外です（必要時は `npm run build:linux` でローカルビルド）。

---

## 1. リリースの実行

1. `package.json` の `version` を上げる（例: `1.0.0` → `1.0.1`）。
2. 変更を `release` ブランチへ push（または GitHub の Actions から `Release` を手動実行）。
3. `mac` ジョブが完了すると、GitHub Releases に **下書きリリース**（`v<version>`）が作成され、dmg/zip が添付されます。内容を確認して **Publish** すると一般ユーザーに公開されます。
4. `windows` ジョブの Artifact `windows-store-package`（`.appx`）をダウンロードし、Partner Center に提出します（§3）。

---

## 2. macOS 署名 + 公証 に必要な情報と保存場所

### 保存場所

GitHub リポジトリ → **Settings → Secrets and variables → Actions → New repository secret**
（リポジトリ: `kztmk/mokumokuren`）

### 登録する Secrets

| Secret 名 | 内容 | 取得方法 |
| --- | --- | --- |
| `CSC_LINK` | **Developer ID Application 証明書(.p12)** を base64 化した文字列 | 下記「証明書の用意」参照 |
| `CSC_KEY_PASSWORD` | `.p12` 書き出し時に設定したパスワード | 自分で設定した値 |
| `APPLE_ID` | Apple Developer アカウントのメールアドレス | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | **App用パスワード**（公証で使用） | <https://appleid.apple.com> → 「サインインとセキュリティ」→「アプリ用パスワード」で生成 |
| `APPLE_TEAM_ID` | 10桁の **Team ID** | <https://developer.apple.com/account> → Membership |

> `GITHUB_TOKEN` は Actions が自動付与します（ワークフローに `permissions: contents: write` 設定済み）。追加登録は不要です。

### 証明書の用意（`CSC_LINK` / `CSC_KEY_PASSWORD`）

1. Apple Developer で **「Developer ID Application」証明書**を作成
   （Keychain Access で CSR 作成 → developer.apple.com でアップロード → ダウンロード → ダブルクリックで Keychain にインストール）。
2. **Keychain Access** で `Developer ID Application: <名前> (TEAMID)` を**秘密鍵ごと**選択 → 右クリック「書き出す」→ `.p12` 形式で保存（**パスワードを設定**＝`CSC_KEY_PASSWORD`）。
3. base64 化してコピー:
   ```sh
   base64 -i DeveloperID.p12 | pbcopy
   ```
   これを `CSC_LINK` に貼り付け。

### 補足

- 公証は `notarytool`（電子公証）を使用します（electron-builder.yml の `mac.notarize: true`）。
- mac は **arm64 と x64 の両方の dmg** が生成されます（Apple Silicon / Intel 両対応）。
- これらの Secrets が未登録のうちは `mac` ジョブは署名/公証で失敗します（想定どおり）。登録後に再実行してください。

---

## 3. Windows（Microsoft Store / MSIX）

CIでは**署名しません**（ストアがアップロード時に署名します）。提出には Partner Center 側のアプリ ID が必要です。

1. **Partner Center** でアプリ名を予約（<https://partner.microsoft.com>）。
2. 予約後、**Product identity** の値を `electron-builder.yml` の `appx:` に反映:
   | electron-builder.yml | Partner Center の項目 |
   | --- | --- |
   | `appx.identityName` | Package/Identity/**Name** |
   | `appx.publisher` | Package/Identity/**Publisher**（`CN=...`） |
   | `appx.publisherDisplayName` | Package/Properties/**PublisherDisplayName** |
3. `release` ブランチへ push → `windows` ジョブが MSIX を生成。
4. Actions の Artifact **`windows-store-package`** をダウンロードし、Partner Center の該当アプリ →「パッケージ」へアップロード → 申請。**ストア審査時に署名されます。**

> `appx` のプレースホルダ（`PUBLISHER...` / `CN=000...`）を実値に置き換えるまでは、生成される appx はローカルテスト用でストアには受理されません。

---

## 4. アップデート（自動更新）

- **Windows 版**: **Microsoft Store が自動更新を担当**します（アプリ側の実装は不要・不可）。ユーザーは Store の「設定 → アプリの更新」で自動更新の ON/OFF を制御できます。新バージョンは Partner Center に新パッケージを提出するだけで配信されます。
- **macOS 版**: **electron-updater による起動時チェック**を実装済み（`src/main/autoUpdate.ts`）。
  - 起動時に GitHub Releases を確認し、新バージョンがあれば自動ダウンロード。
  - **サイドバー下部の更新ボタン**で手動チェックも可能（状態に応じて ↻ 確認 / ⟳ 確認中 / 数値 ダウンロード進捗% / ⟲ 再起動して更新 を表示）。ダウンロード完了後にボタンをクリックすると再起動して適用（未クリックなら次回起動時に適用）。Windows では Store が更新を担当するため、このボタンは macOS でのみ表示。
  - 動作要件: アプリが署名・公証済みであること（リリースビルドは満たす）。dev ビルドでは無効（ボタンは表示されるが「配布版でのみ」表示）。
  - 配信に使うのは GitHub Releases の `.zip` と `latest-mac.yml`（CIが生成・publish）。**dmg だけでなく zip も公開される必要があります**（本設定で対応済み）。

---

## 5. ユーザーへの案内

- **Windows 版**: Microsoft Store の審査・公開後に発行される**ストア製品ページの URL** を案内（README 等に記載）。インストール・更新はストアが行います。
- **macOS 版**: GitHub Releases の該当バージョンの **dmg（arm64 / x64）** を案内。ユーザーは自分の Mac に合う dmg をダウンロードしてインストール。以降の更新は起動時チェックで自動適用されます。

---

## 6. 補足

- `electron-builder.yml` の `appId`（`com.kztmk.mokumokuren`）は要確認。
- 新バージョン公開時は `package.json` の `version` を必ず上げること（mac 自動更新／Store 提出の両方でバージョン比較に使われます）。
