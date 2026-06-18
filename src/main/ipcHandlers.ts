import { ipcMain, type BrowserWindow, type WebContentsView, type WebContents } from 'electron'
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

// Extracts the account HANDLE (not the display name): it feeds buildNavigationUrl's
// `:username` substitution, so it must be the URL handle. Sourced from the logged-in user's
// own profile link/localStorage — never from post-author links — and returns null when not
// resolvable, which safely greys out the Profile menu instead of navigating to a wrong URL.
const USERNAME_SELECTOR: Record<ServiceName, string> = {
  x: `(() => {
    const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')
    const href = a && a.getAttribute('href')
    return href ? href.replace(/^\\//, '') || null : null
  })()`,
  bluesky: `(() => {
    try {
      const root = JSON.parse(localStorage.getItem('BSKY_STORAGE') || 'null')
      return root?.session?.currentAccount?.handle ?? null
    } catch {
      return null
    }
  })()`,
  threads: `(() => {
    const svg = document.querySelector('svg[aria-label="Profile"], svg[aria-label="プロフィール"]')
    const a = svg && svg.closest('a[href^="/@"]')
    const href = a && a.getAttribute('href')
    return href ? href.replace(/^\\/@?/, '').replace(/[/?].*$/, '') || null : null
  })()`,
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

type IsLoggedInFn = (wc: WebContents, service: string) => Promise<boolean>

// Last successfully scraped profile per column. Username/avatar selectors only resolve on
// certain pages, so we fall back to the cached value while still logged in instead of
// flashing nulls when the user navigates off the profile-bearing page.
const lastGoodProfile = new Map<string, { username: string | null; avatarUrl: string | null }>()
// Last payload emitted per column, so polling / repeated navigation events don't spam the
// renderer with identical updates.
const lastEmitted = new Map<string, string>()

async function emitAccountInfo(
  columnId: string,
  managedView: ManagedView,
  win: BrowserWindow,
  isLoggedIn: IsLoggedInFn
): Promise<void> {
  const { service } = managedView.descriptor
  const wc = managedView.view.webContents
  if (wc.isDestroyed()) return

  const loggedIn = await isLoggedIn(wc, service)
  // isLoggedIn awaits DOM/cookie checks; the view may have been torn down meanwhile.
  if (wc.isDestroyed()) return

  let username: string | null = null
  let avatarUrl: string | null = null
  if (loggedIn) {
    const [scrapedUsername, scrapedAvatar] = await Promise.all([
      wc.executeJavaScript(USERNAME_SELECTOR[service]).catch(() => null),
      wc.executeJavaScript(AVATAR_URL_SELECTOR[service]).catch(() => null),
    ])
    const cached = lastGoodProfile.get(columnId)
    username = scrapedUsername ?? cached?.username ?? null
    avatarUrl = scrapedAvatar ?? cached?.avatarUrl ?? null
    lastGoodProfile.set(columnId, { username, avatarUrl })
  } else {
    lastGoodProfile.delete(columnId)
  }

  // Keep the descriptor's handle in sync so buildNavigationUrl resolves Profile links to the
  // logged-in user (not the startup 'proto' placeholder). USERNAME_SELECTOR yields a handle or
  // null, so a failed scrape greys the menu rather than navigating to a wrong URL.
  managedView.descriptor.username = username

  const payload = { columnId, service, username, avatarUrl, loggedIn }
  const signature = JSON.stringify(payload)
  if (lastEmitted.get(columnId) === signature) return
  lastEmitted.set(columnId, signature)

  // The detection above is async; the window may have been closed in the meantime.
  if (win.isDestroyed()) return
  win.webContents.send(CHANNELS.ACCOUNTS_CHANGED, payload)
}

// Re-evaluate login state at least this often, to catch sign-outs that happen without a
// navigation event (Bluesky/Threads are SPAs and can clear their session in place).
const ACCOUNT_POLL_INTERVAL_MS = 4000

function buildNavigationUrl(view: ManagedView, menuKey: MenuKey): string | null {
  const baseUrl = SNS_URLS[view.descriptor.service]
  const path = NAV_MAP[view.descriptor.service][menuKey]
  if (path === null) return null

  // Without this, a null username collapses `:username` to '' and yields a broken URL
  // (e.g. /profile/) that passes the includes() check below; bail out instead.
  if (path.includes(':username') && !view.descriptor.username) return null

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
      if (managedView.view.webContents.isDestroyed()) return
      await managedView.view.webContents
        .executeJavaScript(POST_TRIGGER[serviceName])
        .catch(() => {})
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
      if (win.isDestroyed()) return
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: managedView.view.webContents.canGoBack(),
        canGoForward: managedView.view.webContents.canGoForward(),
      })
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })

    managedView.view.webContents.on('did-finish-load', () => {
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })

    managedView.view.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (!isMainFrame) return
      if (win.isDestroyed()) return
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: managedView.view.webContents.canGoBack(),
        canGoForward: managedView.view.webContents.canGoForward(),
      })
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })
  })

  // Safety net: sign-outs in an SPA can clear the session without firing a navigation, so
  // poll login state and let the dedupe in emitAccountInfo suppress no-op updates.
  const pollTimer = setInterval(() => {
    viewRegistry.forEach((managedView, columnId) => {
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })
  }, ACCOUNT_POLL_INTERVAL_MS)

  // ipcMain.handle registrations are process-global. On macOS the window can be closed and
  // re-created (app `activate`), which calls setupIpcHandlers again — so the old handlers must
  // be removed here, otherwise the second registration throws and the per-column state leaks.
  win.on('closed', () => {
    clearInterval(pollTimer)
    // Module-level caches would otherwise carry stale state into a re-created window.
    lastGoodProfile.clear()
    lastEmitted.clear()
    ipcMain.removeHandler(CHANNELS.NAVIGATE)
    ipcMain.removeHandler(CHANNELS.SET_ACTIVE_COLUMN)
    ipcMain.removeHandler(CHANNELS.GO_BACK)
    ipcMain.removeHandler(CHANNELS.GO_FORWARD)
    ipcMain.removeHandler(CHANNELS.COMPOSE_POST)
    ipcMain.removeHandler(CHANNELS.SET_COLUMN_VISIBLE)
    ipcMain.removeHandler(CHANNELS.CLOSE_COLUMN)
    ipcMain.removeHandler(CHANNELS.REQUEST_ADD_ACCOUNT)
  })
}
