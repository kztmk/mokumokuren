import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CHANNELS } from '../shared/channels'
import type { ColumnLayoutSnapshot, MenuKey, ServiceName } from '../renderer/src/services'

type AccountInfo = {
  columnId: string
  service: string
  username: string | null
  avatarUrl: string | null
}
type NavState = { columnId: string; canGoBack: boolean; canGoForward: boolean }
type BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => void
  onAccountsChanged: (callback: (info: AccountInfo) => void) => void
  navigate: (columnId: string, menuKey: MenuKey) => void
  setActiveColumn: (columnId: string) => void
  setColumnVisible: (columnId: string, visible: boolean) => void
  goBack: (columnId: string) => void
  goForward: (columnId: string) => void
  onNavStateChanged: (callback: (state: NavState) => void) => void
  onActiveChanged: (callback: (columnId: string) => void) => void
  closeColumn: (columnId: string) => void
  composePost: (service: ServiceName) => void
  requestAddAccount: (service: ServiceName) => void
}

// Custom APIs for renderer
const api = {}
const bridgeAPI: BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void): void => {
    ipcRenderer.on(CHANNELS.COLUMN_LAYOUT, (_, snap: ColumnLayoutSnapshot) => callback(snap))
  },
  onAccountsChanged: (callback: (info: AccountInfo) => void): void => {
    ipcRenderer.on(CHANNELS.ACCOUNTS_CHANGED, (_, info: AccountInfo) => callback(info))
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
  onNavStateChanged: (callback: (state: NavState) => void): void => {
    ipcRenderer.on(CHANNELS.NAV_STATE_CHANGED, (_, state: NavState) => callback(state))
  },
  onActiveChanged: (callback: (columnId: string) => void): void => {
    ipcRenderer.on(CHANNELS.ACTIVE_CHANGED, (_, columnId: string) => callback(columnId))
  },
  closeColumn: (columnId: string): void => {
    void ipcRenderer.invoke(CHANNELS.CLOSE_COLUMN, columnId)
  },
  composePost: (service: ServiceName): void => {
    void ipcRenderer.invoke(CHANNELS.COMPOSE_POST, service)
  },
  requestAddAccount: (service: ServiceName): void => {
    void ipcRenderer.invoke(CHANNELS.REQUEST_ADD_ACCOUNT, service)
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
