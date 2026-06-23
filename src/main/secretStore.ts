import ElectronStore, { type Schema } from 'electron-store'
import { decryptString, encryptString, isEncryptionAvailable } from './safeStorageWrapper'

// 機微な値（Gemini API キー / 虎威アンロックキー）は safeStorage で暗号化した base64 を保存する。
// status キャッシュ（オフライン猶予用）は機微でないので平文。

export type GateStatusCache = {
  active: boolean
  // 'ok' = active会員 / 'inactive' = キー有効だが非会員 / 'invalid-key' = 403
  reason: 'ok' | 'inactive' | 'invalid-key'
  checkedAt: string
  nextRefreshAt: string | null
}

type SecretStoreSchema = {
  geminiApiKeyEnc: string | null
  toraiUnlockKeyEnc: string | null
  gateStatus: GateStatusCache | null
}

const schema: Schema<SecretStoreSchema> = {
  geminiApiKeyEnc: { type: ['string', 'null'], default: null },
  toraiUnlockKeyEnc: { type: ['string', 'null'], default: null },
  gateStatus: {
    type: ['object', 'null'],
    default: null,
  },
}

const store = new ElectronStore<SecretStoreSchema>({
  name: 'secrets',
  defaults: {
    geminiApiKeyEnc: null,
    toraiUnlockKeyEnc: null,
    gateStatus: null,
  },
  schema,
})

export type SecretKind = 'gemini' | 'unlock'

const FIELD: Record<SecretKind, 'geminiApiKeyEnc' | 'toraiUnlockKeyEnc'> = {
  gemini: 'geminiApiKeyEnc',
  unlock: 'toraiUnlockKeyEnc',
}

// 暗号化して保存。暗号化が使えない環境では false（呼び出し側でエラー表示）。
export function setSecret(kind: SecretKind, plainText: string): boolean {
  const enc = encryptString(plainText)
  if (enc === null) return false
  store.set(FIELD[kind], enc)
  return true
}

export function clearSecret(kind: SecretKind): void {
  store.set(FIELD[kind], null)
}

export function getSecret(kind: SecretKind): string | null {
  const enc = store.get(FIELD[kind])
  if (!enc) return null
  return decryptString(enc)
}

export function hasSecret(kind: SecretKind): boolean {
  return Boolean(store.get(FIELD[kind]))
}

export function getGateStatus(): GateStatusCache | null {
  return store.get('gateStatus')
}

export function setGateStatus(status: GateStatusCache | null): void {
  store.set('gateStatus', status)
}

export function secretsEncryptionAvailable(): boolean {
  return isEncryptionAvailable()
}
