import { ElectronAPI } from '@electron-toolkit/preload'
import type { ColumnLayoutSnapshot, MenuKey, ServiceName } from '../renderer/src/services'

type NavState = { columnId: string; canGoBack: boolean; canGoForward: boolean }

interface ElectronBridgeAPI {
  onColumnLayout: (callback: (snap: ColumnLayoutSnapshot) => void) => void
  onAccountsChanged: (
    callback: (info: {
      columnId: string
      service: string
      username: string | null
      avatarUrl: string | null
      loggedIn: boolean
    }) => void
  ) => void
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

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    electronAPI: ElectronBridgeAPI
  }
}
