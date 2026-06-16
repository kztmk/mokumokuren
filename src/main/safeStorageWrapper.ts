import { safeStorage } from 'electron'

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

// 将来拡張用のシグネチャ（実装は空のままでよい — ADR-0002準拠）
// export function encryptString(plainText: string): Buffer { ... }
// export function decryptString(encrypted: Buffer): string { ... }
