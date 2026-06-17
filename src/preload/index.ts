import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ColumnLayoutSnapshot } from '../renderer/src/services'

type AccountInfo = { accountId: string; service: string; username: string | null }
type BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => void
  onAccountsChanged: (callback: (accounts: AccountInfo[]) => void) => void
  navigate: (columnId: string, url: string) => void
  setActiveColumn: (columnId: string) => void
  setColumnVisible: (columnId: string, visible: boolean) => void
  closeColumn: (columnId: string) => void
  composePost: (service: string) => void
  requestAddAccount: (service: string) => void
}

// Custom APIs for renderer
const api = {}
const bridgeAPI: BridgeAPI = {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void): void => {
    ipcRenderer.on('column-layout', (_, snap: ColumnLayoutSnapshot) => callback(snap))
  },
  onAccountsChanged: (callback: (accounts: AccountInfo[]) => void): void => {
    ipcRenderer.on('accounts-changed', (_, accounts: AccountInfo[]) => callback(accounts))
  },
  navigate: (): void => {},
  setActiveColumn: (): void => {},
  setColumnVisible: (): void => {},
  closeColumn: (): void => {},
  composePost: (): void => {},
  requestAddAccount: (): void => {},
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
