import { ipcMain, type BrowserWindow, type WebContentsView, type Session } from 'electron'
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

const USERNAME_SELECTOR: Record<ServiceName, string> = {
  x: `document.querySelector('a[href="/home"] + div [data-testid="UserName"] span')?.textContent ?? null`,
  bluesky: `document.querySelector('[aria-label*="profile"] .r-jwli3a')?.textContent ?? null`,
  threads: `document.querySelector('a[href*="/@"] span.x1lliihq')?.textContent ?? null`,
}

const AVATAR_URL_SELECTOR: Record<ServiceName, string> = {
  x: `document.querySelector('a[href*="/photo"] img[src*="profile_images"]')?.src ?? null`,
  bluesky: `document.querySelector('[aria-label*="profile"] img[src*="avatar"]')?.src ?? null`,
  threads: `document.querySelector('img._aagu')?.src ?? null`,
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

type IsLoggedInFn = (ses: Session, service: string) => Promise<boolean>

async function emitAccountInfo(
  columnId: string,
  managedView: ManagedView,
  win: BrowserWindow,
  isLoggedIn: IsLoggedInFn
): Promise<void> {
  const { service } = managedView.descriptor
  const ses = managedView.view.webContents.session
  const loggedIn = await isLoggedIn(ses, service)
  if (!loggedIn) {
    win.webContents.send(CHANNELS.ACCOUNTS_CHANGED, {
      columnId,
      service,
      username: null,
      avatarUrl: null,
      loggedIn: false,
    })
    return
  }

  const [username, avatarUrl] = await Promise.all([
    managedView.view.webContents.executeJavaScript(USERNAME_SELECTOR[service]).catch(() => null),
    managedView.view.webContents.executeJavaScript(AVATAR_URL_SELECTOR[service]).catch(() => null),
  ])
  win.webContents.send(CHANNELS.ACCOUNTS_CHANGED, {
    columnId,
    service,
    username,
    avatarUrl,
    loggedIn: true,
  })
}

function isHomeUrl(service: ServiceName, url: string): boolean {
  try {
    const parsed = new URL(url)
    switch (service) {
      case 'x':
        return (
          (parsed.hostname === 'x.com' || parsed.hostname === 'twitter.com') &&
          parsed.pathname === '/home'
        )
      case 'bluesky':
        return parsed.hostname === 'bsky.app' && parsed.pathname === '/'
      case 'threads':
        return parsed.hostname === 'www.threads.net' && parsed.pathname === '/'
      default:
        return false
    }
  } catch {
    return false
  }
}

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

export function setupIpcHandlers(
  viewRegistry: ViewRegistry,
  win: BrowserWindow,
  isLoggedIn: IsLoggedInFn
): void {
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
    const { service } = managedView.descriptor

    managedView.view.webContents.on('did-navigate', (_event, url) => {
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: managedView.view.webContents.canGoBack(),
        canGoForward: managedView.view.webContents.canGoForward(),
      })
      if (isHomeUrl(service, url)) {
        void emitAccountInfo(columnId, managedView, win, isLoggedIn)
      }
    })

    managedView.view.webContents.on('did-finish-load', () => {
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })

    managedView.view.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: managedView.view.webContents.canGoBack(),
        canGoForward: managedView.view.webContents.canGoForward(),
      })
      if (isHomeUrl(service, url)) {
        void emitAccountInfo(columnId, managedView, win, isLoggedIn)
      }
    })
  })
}
