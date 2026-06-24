import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountSummary,
  AiState,
  ColumnLayoutSnapshot,
  GenerateResult,
  MenuKey,
  ServiceName,
} from '../renderer/src/services'

type NavState = { columnId: string; canGoBack: boolean; canGoForward: boolean }
type Unread = { columnId: string; count: number }
type UpdateStatus = {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'not-available'
    | 'error'
    | 'unsupported'
  version?: string
  percent?: number
  message?: string
}
type Unsubscribe = () => void

interface ElectronBridgeAPI {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => Unsubscribe
  onAccountsList: (callback: (accounts: AccountSummary[]) => void) => Unsubscribe
  onUnreadChanged: (callback: (unread: Unread) => void) => Unsubscribe
  onAccountsChanged: (
    callback: (info: {
      columnId: string
      service: string
      username: string | null
      avatarUrl: string | null
      loggedIn: boolean
    }) => void
  ) => Unsubscribe
  navigate: (columnId: string, menuKey: MenuKey) => void
  setActiveColumn: (columnId: string) => void
  setColumnVisible: (columnId: string, visible: boolean) => void
  goBack: (columnId: string) => void
  goForward: (columnId: string) => void
  onNavStateChanged: (callback: (state: NavState) => void) => Unsubscribe
  onActiveChanged: (callback: (columnId: string) => void) => Unsubscribe
  closeColumn: (columnId: string) => void
  composePost: (service: ServiceName, text?: string) => void
  requestAddAccount: () => void
  reorderColumns: (orderedVisibleIds: string[]) => void
  scrollColumns: (delta: number) => void
  rendererReady: () => void
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => Unsubscribe
  checkForUpdates: () => void
  quitAndInstall: () => void
  onAiState: (callback: (state: AiState) => void) => Unsubscribe
  getAiState: () => Promise<AiState>
  setUnlockKey: (key: string) => Promise<AiState>
  clearUnlockKey: () => Promise<AiState>
  checkSubscription: () => Promise<AiState>
  setGeminiKey: (key: string) => Promise<boolean>
  clearGeminiKey: () => Promise<void>
  generateDrafts: (keyword: string, service: ServiceName) => Promise<GenerateResult>
  setAiOverlay: (on: boolean) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    electronAPI: ElectronBridgeAPI
  }
}
