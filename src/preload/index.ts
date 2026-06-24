import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CHANNELS } from '../shared/channels'
import type {
  AccountSummary,
  AiState,
  ColumnLayoutSnapshot,
  GenerateResult,
  MenuKey,
  ServiceName,
} from '../renderer/src/services'

type AccountInfo = {
  columnId: string
  service: string
  username: string | null
  avatarUrl: string | null
  loggedIn: boolean
}
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
type BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => Unsubscribe
  onAccountsList: (callback: (accounts: AccountSummary[]) => void) => Unsubscribe
  onAccountsChanged: (callback: (info: AccountInfo) => void) => Unsubscribe
  onUnreadChanged: (callback: (unread: Unread) => void) => Unsubscribe
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
  // Phase 7: AI 下書き
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

// Custom APIs for renderer
const api = {}
const bridgeAPI: BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void): Unsubscribe => {
    const listener = (_: unknown, snap: ColumnLayoutSnapshot): void => callback(snap)
    ipcRenderer.on(CHANNELS.COLUMN_LAYOUT, listener)
    return () => ipcRenderer.removeListener(CHANNELS.COLUMN_LAYOUT, listener)
  },
  onAccountsList: (callback: (accounts: AccountSummary[]) => void): Unsubscribe => {
    const listener = (_: unknown, accounts: AccountSummary[]): void => callback(accounts)
    ipcRenderer.on(CHANNELS.ACCOUNTS_LIST, listener)
    return () => ipcRenderer.removeListener(CHANNELS.ACCOUNTS_LIST, listener)
  },
  onAccountsChanged: (callback: (info: AccountInfo) => void): Unsubscribe => {
    const listener = (_: unknown, info: AccountInfo): void => callback(info)
    ipcRenderer.on(CHANNELS.ACCOUNTS_CHANGED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.ACCOUNTS_CHANGED, listener)
  },
  onUnreadChanged: (callback: (unread: Unread) => void): Unsubscribe => {
    const listener = (_: unknown, unread: Unread): void => callback(unread)
    ipcRenderer.on(CHANNELS.UNREAD_CHANGED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.UNREAD_CHANGED, listener)
  },
  navigate: (columnId: string, menuKey: MenuKey): void => {
    void ipcRenderer.invoke(CHANNELS.NAVIGATE, columnId, menuKey)
  },
  setActiveColumn: (columnId: string): void => {
    void ipcRenderer.invoke(CHANNELS.SET_ACTIVE_COLUMN, columnId)
  },
  setColumnVisible: (columnId: string, visible: boolean): void => {
    void ipcRenderer.invoke(CHANNELS.SET_COLUMN_VISIBLE, columnId, visible)
  },
  goBack: (columnId: string): void => {
    void ipcRenderer.invoke(CHANNELS.GO_BACK, columnId)
  },
  goForward: (columnId: string): void => {
    void ipcRenderer.invoke(CHANNELS.GO_FORWARD, columnId)
  },
  onNavStateChanged: (callback: (state: NavState) => void): Unsubscribe => {
    const listener = (_: unknown, state: NavState): void => callback(state)
    ipcRenderer.on(CHANNELS.NAV_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.NAV_STATE_CHANGED, listener)
  },
  onActiveChanged: (callback: (columnId: string) => void): Unsubscribe => {
    const listener = (_: unknown, columnId: string): void => callback(columnId)
    ipcRenderer.on(CHANNELS.ACTIVE_CHANGED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.ACTIVE_CHANGED, listener)
  },
  closeColumn: (columnId: string): void => {
    void ipcRenderer.invoke(CHANNELS.CLOSE_COLUMN, columnId)
  },
  composePost: (service: ServiceName, text?: string): void => {
    void ipcRenderer.invoke(CHANNELS.COMPOSE_POST, service, text)
  },
  requestAddAccount: (): void => {
    void ipcRenderer.invoke(CHANNELS.REQUEST_ADD_ACCOUNT)
  },
  reorderColumns: (orderedVisibleIds: string[]): void => {
    void ipcRenderer.invoke(CHANNELS.REORDER_COLUMNS, orderedVisibleIds)
  },
  scrollColumns: (delta: number): void => {
    void ipcRenderer.invoke(CHANNELS.SCROLL_COLUMNS, delta)
  },
  rendererReady: (): void => {
    void ipcRenderer.invoke(CHANNELS.RENDERER_READY)
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void): Unsubscribe => {
    const listener = (_: unknown, status: UpdateStatus): void => callback(status)
    ipcRenderer.on(CHANNELS.UPDATE_STATUS, listener)
    return () => ipcRenderer.removeListener(CHANNELS.UPDATE_STATUS, listener)
  },
  checkForUpdates: (): void => {
    void ipcRenderer.invoke(CHANNELS.CHECK_FOR_UPDATES)
  },
  quitAndInstall: (): void => {
    void ipcRenderer.invoke(CHANNELS.QUIT_AND_INSTALL)
  },
  onAiState: (callback: (state: AiState) => void): Unsubscribe => {
    const listener = (_: unknown, state: AiState): void => callback(state)
    ipcRenderer.on(CHANNELS.AI_STATE, listener)
    return () => ipcRenderer.removeListener(CHANNELS.AI_STATE, listener)
  },
  getAiState: (): Promise<AiState> => ipcRenderer.invoke(CHANNELS.GET_AI_STATE),
  setUnlockKey: (key: string): Promise<AiState> => ipcRenderer.invoke(CHANNELS.SET_UNLOCK_KEY, key),
  clearUnlockKey: (): Promise<AiState> => ipcRenderer.invoke(CHANNELS.CLEAR_UNLOCK_KEY),
  checkSubscription: (): Promise<AiState> => ipcRenderer.invoke(CHANNELS.CHECK_SUBSCRIPTION),
  setGeminiKey: (key: string): Promise<boolean> => ipcRenderer.invoke(CHANNELS.SET_GEMINI_KEY, key),
  clearGeminiKey: (): Promise<void> => ipcRenderer.invoke(CHANNELS.CLEAR_GEMINI_KEY),
  generateDrafts: (keyword: string, service: ServiceName): Promise<GenerateResult> =>
    ipcRenderer.invoke(CHANNELS.GENERATE_DRAFTS, keyword, service),
  setAiOverlay: (on: boolean): void => {
    void ipcRenderer.invoke(CHANNELS.SET_AI_OVERLAY, on)
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', bridgeAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.electronAPI = bridgeAPI
  // @ts-ignore (define in dts)
  window.api = api
}
