import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CHANNELS } from '../shared/channels'
import type {
  AccountSummary,
  ColumnLayoutSnapshot,
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
type Unsubscribe = () => void
type BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => Unsubscribe
  onAccountsList: (callback: (accounts: AccountSummary[]) => void) => Unsubscribe
  onAccountsChanged: (callback: (info: AccountInfo) => void) => Unsubscribe
  navigate: (columnId: string, menuKey: MenuKey) => void
  setActiveColumn: (columnId: string) => void
  setColumnVisible: (columnId: string, visible: boolean) => void
  goBack: (columnId: string) => void
  goForward: (columnId: string) => void
  onNavStateChanged: (callback: (state: NavState) => void) => Unsubscribe
  onActiveChanged: (callback: (columnId: string) => void) => Unsubscribe
  closeColumn: (columnId: string) => void
  composePost: (service: ServiceName) => void
  requestAddAccount: () => void
  reorderColumns: (orderedVisibleIds: string[]) => void
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
  composePost: (service: ServiceName): void => {
    void ipcRenderer.invoke(CHANNELS.COMPOSE_POST, service)
  },
  requestAddAccount: (): void => {
    void ipcRenderer.invoke(CHANNELS.REQUEST_ADD_ACCOUNT)
  },
  reorderColumns: (orderedVisibleIds: string[]): void => {
    void ipcRenderer.invoke(CHANNELS.REORDER_COLUMNS, orderedVisibleIds)
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
