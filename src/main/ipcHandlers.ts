import { ipcMain, type BrowserWindow, type WebContentsView } from 'electron'
import { CHANNELS } from '../shared/channels'
import {
  COMPOSE_URL,
  NAV_MAP,
  POST_TRIGGER,
  type MenuKey,
  type ServiceName,
} from '../renderer/src/services'

const SNS_URLS: Record<ServiceName, URL> = {
  x: new URL('https://x.com'),
  bluesky: new URL('https://bsky.app'),
  threads: new URL('https://www.threads.net'),
}

type ManagedView = {
  view: WebContentsView
  descriptor: {
    accountId: string
    service: ServiceName
    username: string | null
  }
}

type ViewRegistry = Map<string, ManagedView>

function buildNavigationUrl(view: ManagedView, menuKey: MenuKey): string | null {
  const baseUrl = SNS_URLS[view.descriptor.service]
  const path = NAV_MAP[view.descriptor.service][menuKey]
  if (path === null) return null

  const resolvedPath = path.replace(':username', view.descriptor.username ?? '')
  if (resolvedPath.includes(':username')) return null

  const url = new URL(resolvedPath, baseUrl)
  if (url.origin !== baseUrl.origin) return null

  return url.toString()
}

export function setupIpcHandlers(viewRegistry: ViewRegistry, win: BrowserWindow): void {
  let activeColumnId: string | null = null

  ipcMain.handle(CHANNELS.NAVIGATE, (_event, columnId: string, menuKey: MenuKey) => {
    const managedView = viewRegistry.get(columnId)
    if (!managedView) return

    const url = buildNavigationUrl(managedView, menuKey)
    if (!url) return

    void managedView.view.webContents.loadURL(url)
  })

  ipcMain.handle(CHANNELS.SET_ACTIVE_COLUMN, (_event, columnId: string) => {
    if (!viewRegistry.has(columnId)) return

    activeColumnId = columnId
    win.webContents.send(CHANNELS.ACTIVE_CHANGED, activeColumnId)
  })

  ipcMain.handle(CHANNELS.GO_BACK, (_event, columnId: string) => {
    const managedView = viewRegistry.get(columnId)
    if (!managedView?.view.webContents.canGoBack()) return

    managedView.view.webContents.goBack()
  })

  ipcMain.handle(CHANNELS.GO_FORWARD, (_event, columnId: string) => {
    const managedView = viewRegistry.get(columnId)
    if (!managedView?.view.webContents.canGoForward()) return

    managedView.view.webContents.goForward()
  })

  ipcMain.handle(CHANNELS.COMPOSE_POST, async (_event, service: string) => {
    if (!(service in COMPOSE_URL)) return
    if (activeColumnId === null) return

    const serviceName = service as ServiceName
    const managedView = viewRegistry.get(activeColumnId)
    if (
      !managedView ||
      managedView.descriptor.service !== serviceName ||
      managedView.view.webContents.isDestroyed()
    ) {
      return
    }

    const composeUrl = new URL(COMPOSE_URL[serviceName], SNS_URLS[serviceName])
    try {
      await managedView.view.webContents.loadURL(composeUrl.toString())
    } catch {
      await managedView.view.webContents.executeJavaScript(POST_TRIGGER[serviceName])
    }
  })

  ipcMain.handle(CHANNELS.SET_COLUMN_VISIBLE, () => {
    // Phase5 scope.
  })

  ipcMain.handle(CHANNELS.CLOSE_COLUMN, () => {
    // Phase5 scope.
  })

  ipcMain.handle(CHANNELS.REQUEST_ADD_ACCOUNT, () => {
    // Phase5 scope.
  })

  viewRegistry.forEach((managedView, columnId) => {
    managedView.view.webContents.on('did-navigate', () => {
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: managedView.view.webContents.canGoBack(),
        canGoForward: managedView.view.webContents.canGoForward(),
      })
    })
    managedView.view.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (!isMainFrame) return
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: managedView.view.webContents.canGoBack(),
        canGoForward: managedView.view.webContents.canGoForward(),
      })
    })
  })
}
