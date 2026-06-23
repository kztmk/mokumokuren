import { safeStorage } from 'electron'

// safeStorage は OS のキーチェーン連携で暗号化する（mac: Keychain / win: DPAPI / linux: libsecret 等）。
// ADR-0002: 「将来 electron-store に機微な値を書く場合の暗号化手段」として枠を残していたもの。
// Phase 7 で Gemini API キー / 虎威アンロックキーを暗号化保存するために実装する。

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

// 平文 → base64 暗号文。暗号化が使えない環境では null（呼び出し側で保存を拒否する）。
export function encryptString(plainText: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(plainText).toString('base64')
}

// base64 暗号文 → 平文。復号に失敗したら null（破損／別ユーザー／別マシン）。
export function decryptString(encryptedBase64: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
  } catch {
    return null
  }
}
