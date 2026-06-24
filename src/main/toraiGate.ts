import { ipcMain, net, type BrowserWindow } from 'electron'
import { CHANNELS } from '../shared/channels'
import {
  clearSecret,
  getGateStatus,
  getSecret,
  hasSecret,
  secretsEncryptionAvailable,
  setGateStatus,
  setSecret,
  type GateStatusCache,
} from './secretStore'

// 虎威サブスクリプション・ゲート（A案）。
// アプリ → POST checkFreeToolSubscriptionStatus {unlockKey} → {subscription_status} のみ取得。
// AI 生成自体は BYOK ローカル（geminiDrafts.ts）なので、ここは「利用可否」の判定だけを担う。

export type AiReason =
  | 'ok' // active 会員 → AI 利用可
  | 'no-unlock-key' // アンロックキー未登録
  | 'inactive' // キーは有効だが非会員（200 + inactive）→ 要サブスク
  | 'invalid-key' // 403 キー無効/失効 → 再登録
  | 'error' // 一時障害＋猶予切れ
  | 'unavailable' // safeStorage 不可で保存できない
  | 'checking'

export type AiState = {
  available: boolean // AI 機能を有効化してよいか（オフライン猶予内の active を含む）
  reason: AiReason
  hasUnlockKey: boolean
  hasGeminiKey: boolean
  cached?: boolean // ネットワーク不通でキャッシュを使った
  checkedAt?: string
  nextRefreshAt?: string
  message?: string
}

// 本番（torai-e0d8e）。dev 検証時は環境変数で差し替え可能。
const FUNCTIONS_BASE =
  process.env.TORAI_FUNCTIONS_BASE ?? 'https://asia-northeast1-torai-e0d8e.cloudfunctions.net'
const CHECK_URL = `${FUNCTIONS_BASE}/checkFreeToolSubscriptionStatus`

const REVALIDATE_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6時間ごとの再検証
const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000 // 5xx/オフライン時の猶予（3日）
const REQUEST_TIMEOUT_MS = 15000

let win: BrowserWindow | null = null
let initialized = false
let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let currentState: AiState = {
  available: false,
  reason: 'no-unlock-key',
  hasUnlockKey: false,
  hasGeminiKey: false,
}

function broadcast(): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(CHANNELS.AI_STATE, currentState)
}

function setState(next: AiState): void {
  currentState = next
  broadcast()
}

export function getAiState(): AiState {
  return currentState
}

// Gemini キーの登録/クリア（geminiDrafts.ts 側）後に AiState の hasGeminiKey を反映・再配信する。
export function notifyGeminiKeyChanged(): void {
  setState({ ...currentState, hasGeminiKey: hasSecret('gemini') })
}

// グレース内に収まっているか（5xx/オフライン時にキャッシュ済み active を一定期間有効扱い）
function withinGrace(cache: GateStatusCache, now: number): boolean {
  const checkedAtMs = Date.parse(cache.checkedAt)
  if (Number.isNaN(checkedAtMs)) return false
  const refreshMs = cache.nextRefreshAt ? Date.parse(cache.nextRefreshAt) : NaN
  // サーバキャッシュ期限（nextRefreshAt）か checkedAt+3日 の早い方まで
  const graceUntil = Number.isNaN(refreshMs)
    ? checkedAtMs + OFFLINE_GRACE_MS
    : Math.min(refreshMs, checkedAtMs + OFFLINE_GRACE_MS)
  return now <= graceUntil
}

// ネットワークを使わず、保存済みキャッシュからの可否を算出（起動直後の即時反映用）
function deriveStateFromCache(): AiState {
  const hasUnlockKey = hasSecret('unlock')
  const hasGeminiKey = hasSecret('gemini')
  const base = { hasUnlockKey, hasGeminiKey }

  if (!hasUnlockKey) {
    return { ...base, available: false, reason: 'no-unlock-key' }
  }
  const cache = getGateStatus()
  if (!cache) {
    return { ...base, available: false, reason: 'checking' }
  }
  if (cache.reason === 'invalid-key') {
    return { ...base, available: false, reason: 'invalid-key', checkedAt: cache.checkedAt }
  }
  if (cache.reason === 'inactive') {
    return { ...base, available: false, reason: 'inactive', checkedAt: cache.checkedAt }
  }
  // active キャッシュ — 猶予内なら暫定で利用可（直後に再検証が走る）
  const ok = cache.active && withinGrace(cache, Date.now())
  return {
    ...base,
    available: ok,
    reason: ok ? 'ok' : 'checking',
    cached: true,
    checkedAt: cache.checkedAt,
    nextRefreshAt: cache.nextRefreshAt ?? undefined,
  }
}

type CheckResponse = {
  success?: boolean
  subscription_status?: string
  subscriptionStatus?: string
  checkedAt?: string
  nextRefreshAt?: string
  code?: string
}

// サーバへ問い合わせて状態を更新。force=false でもキーがあれば毎回叩く（サーバ側10日キャッシュ＋
// 状態変化トリガーで即時反映されるため、起動/間隔/オンデマンドで素直に再取得してよい）。
export async function checkSubscription(): Promise<AiState> {
  const hasUnlockKey = hasSecret('unlock')
  const hasGeminiKey = hasSecret('gemini')

  if (!hasUnlockKey) {
    setState({ available: false, reason: 'no-unlock-key', hasUnlockKey, hasGeminiKey })
    return currentState
  }
  if (inFlight) return currentState
  inFlight = true

  const unlockKey = getSecret('unlock')
  if (!unlockKey) {
    // 保存はあるが復号失敗（別マシン等）→ 再登録を促す
    inFlight = false
    setState({ available: false, reason: 'invalid-key', hasUnlockKey, hasGeminiKey })
    return currentState
  }

  // checking を一旦通知（UI のスピナー用）。ただし available は現状維持しない（明示 false）。
  setState({ ...currentState, reason: 'checking', hasUnlockKey, hasGeminiKey })

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    // Electron main では net.fetch を使う（OS/企業プロキシ設定を経由する。グローバル fetch =
    // undici はプロキシを迂回するため、プロキシ環境下で接続に失敗しうる）。
    const res = await net.fetch(CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlockKey }),
      signal: controller.signal,
    })

    if (res.status === 403 || res.status === 400) {
      const cache: GateStatusCache = {
        active: false,
        reason: 'invalid-key',
        checkedAt: new Date().toISOString(),
        nextRefreshAt: null,
      }
      setGateStatus(cache)
      setState({
        available: false,
        reason: 'invalid-key',
        hasUnlockKey,
        hasGeminiKey,
        checkedAt: cache.checkedAt,
      })
      return currentState
    }

    if (!res.ok) {
      // 5xx 等の一時障害 → キャッシュ猶予にフォールバック
      return fallbackToCache(hasUnlockKey, hasGeminiKey, `サーバ応答エラー (${res.status})`)
    }

    const data = (await res.json()) as CheckResponse
    const status = data.subscription_status ?? data.subscriptionStatus
    const active = status === 'active'
    const cache: GateStatusCache = {
      active,
      reason: active ? 'ok' : 'inactive',
      checkedAt: data.checkedAt ?? new Date().toISOString(),
      nextRefreshAt: data.nextRefreshAt ?? null,
    }
    setGateStatus(cache)
    setState({
      available: active,
      reason: active ? 'ok' : 'inactive',
      hasUnlockKey,
      hasGeminiKey,
      cached: false,
      checkedAt: cache.checkedAt,
      nextRefreshAt: cache.nextRefreshAt ?? undefined,
    })
    return currentState
  } catch (err) {
    // ネットワーク不通/タイムアウト → キャッシュ猶予
    return fallbackToCache(
      hasUnlockKey,
      hasGeminiKey,
      err instanceof Error ? err.message : String(err)
    )
  } finally {
    clearTimeout(t)
    inFlight = false
  }
}

function fallbackToCache(hasUnlockKey: boolean, hasGeminiKey: boolean, message: string): AiState {
  const cache = getGateStatus()
  if (cache && cache.active && cache.reason === 'ok' && withinGrace(cache, Date.now())) {
    setState({
      available: true,
      reason: 'ok',
      hasUnlockKey,
      hasGeminiKey,
      cached: true,
      checkedAt: cache.checkedAt,
      nextRefreshAt: cache.nextRefreshAt ?? undefined,
      message: `オフライン: 前回の状態を使用中（${message}）`,
    })
    return currentState
  }
  if (cache && cache.reason === 'inactive') {
    setState({ available: false, reason: 'inactive', hasUnlockKey, hasGeminiKey, cached: true })
    return currentState
  }
  if (cache && cache.reason === 'invalid-key') {
    setState({ available: false, reason: 'invalid-key', hasUnlockKey, hasGeminiKey, cached: true })
    return currentState
  }
  setState({ available: false, reason: 'error', hasUnlockKey, hasGeminiKey, message })
  return currentState
}

export function setupToraiGate(window: BrowserWindow): void {
  win = window
  if (initialized) {
    // mac の window 再生成時はリファレンス更新＋現状を再配信のみ
    broadcast()
    return
  }
  initialized = true

  // 起動時：キャッシュから即時状態を出してから、ネットワーク再検証を裏で回す
  currentState = deriveStateFromCache()

  ipcMain.handle(CHANNELS.GET_AI_STATE, (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return currentState
    return currentState
  })

  ipcMain.handle(CHANNELS.SET_UNLOCK_KEY, async (event, key: unknown) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return currentState
    if (!secretsEncryptionAvailable()) {
      setState({
        available: false,
        reason: 'unavailable',
        hasUnlockKey: hasSecret('unlock'),
        hasGeminiKey: hasSecret('gemini'),
        message: 'この環境では安全な保存（OSキーチェーン）が利用できません。',
      })
      return currentState
    }
    const normalized = typeof key === 'string' ? key.trim().toUpperCase() : ''
    if (!normalized) return currentState
    setSecret('unlock', normalized)
    setGateStatus(null) // 旧キャッシュは破棄して再検証
    return checkSubscription()
  })

  ipcMain.handle(CHANNELS.CLEAR_UNLOCK_KEY, (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return currentState
    clearSecret('unlock')
    setGateStatus(null)
    setState({
      available: false,
      reason: 'no-unlock-key',
      hasUnlockKey: false,
      hasGeminiKey: hasSecret('gemini'),
    })
    return currentState
  })

  ipcMain.handle(CHANNELS.CHECK_SUBSCRIPTION, (event) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return currentState
    return checkSubscription()
  })

  // 定期再検証
  timer = setInterval(() => {
    void checkSubscription()
  }, REVALIDATE_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()

  // 起動時チェック（少し遅延させて初期描画を妨げない）
  setTimeout(() => {
    void checkSubscription()
  }, 1500)
}

// テスト/シャットダウン用（現状未使用だが将来のため）
export function disposeToraiGate(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
