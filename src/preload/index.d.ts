import { ElectronAPI } from '@electron-toolkit/preload'
import type { ColumnLayoutSnapshot } from '../renderer/src/services'

interface ElectronBridgeAPI {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => void
  onAccountsChanged: (
    callback: (accounts: { accountId: string; service: string; username: string | null }[]) => void
  ) => void
  navigate: (columnId: string, url: string) => void
  setActiveColumn: (columnId: string) => void
  setColumnVisible: (columnId: string, visible: boolean) => void
  closeColumn: (columnId: string) => void
  composePost: (service: string) => void
  requestAddAccount: (service: string) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    electronAPI: ElectronBridgeAPI
  }
}
