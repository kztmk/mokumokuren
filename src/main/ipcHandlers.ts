import { ipcMain, type BrowserWindow, type WebContentsView, type WebContents } from 'electron'
import { CHANNELS } from '../shared/channels'
import {
  COMPOSE_URL,
  NAV_MAP,
  POST_TRIGGER,
  SNS_URLS,
  type MenuKey,
  type ServiceName,
} from '../renderer/src/services'

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

// Hosts each service legitimately runs on (mirrors ALLOWED_HOSTS in index.ts). Login detection
// and profile scraping only run when the view is on one of these — on an unrelated page the
// selectors/localStorage reads return nothing, which would otherwise false-positive a logout.
const SERVICE_HOSTS: Record<ServiceName, string[]> = {
  x: ['x.com', 'twitter.com'],
  bluesky: ['bsky.app', 'bsky.social'],
  threads: ['threads.net', 'instagram.com'],
}

function isOnServiceDomain(wc: WebContents, service: ServiceName): boolean {
  try {
    const { hostname } = new URL(wc.getURL())
    return SERVICE_HOSTS[service].some((h) => hostname === h || hostname.endsWith('.' + h))
  } catch {
    return false
  }
}

// Scraped handles are read from untrusted page DOM/localStorage and flow into
// buildNavigationUrl's `:username` substitution. Validate against each platform's handle charset
// before trusting one, so a crafted value can't smuggle path-traversal/URL characters (e.g. `..`)
// into a navigation target.
const HANDLE_PATTERN: Record<ServiceName, RegExp> = {
  x: /^[a-zA-Z0-9_]{1,15}$/,
  // Separators (`.`/`-`) only allowed *between* alphanumeric runs — no leading/trailing/repeated
  // ones. This rejects values like `..` that would otherwise traverse buildNavigationUrl's
  // `:username` path (e.g. /profile/../lists collapsing to /lists). The leading length lookaheads
  // bound the input (Bluesky/DNS: ≤253 total, ≤63 per label) so an injected megastring can't
  // burn CPU/memory in the match/replace.
  bluesky: /^(?=[a-zA-Z0-9.-]{1,253}$)[a-zA-Z0-9]{1,63}([.-][a-zA-Z0-9]{1,63})*$/,
  threads: /^(?=[a-zA-Z0-9._]{1,30}$)[a-zA-Z0-9_]+([.][a-zA-Z0-9_]+)*$/,
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

// Tri-state: true / false / null. null means "indeterminate" (e.g. the Threads SPA shell hasn't
// rendered yet) — emitAccountInfo skips emitting so the last known state holds.
type IsLoggedInFn = (wc: WebContents, service: string) => Promise<boolean | null>

// Last successfully scraped profile per column. Username/avatar selectors only resolve on
// certain pages, so we fall back to the cached value while still logged in instead of
// flashing nulls when the user navigates off the profile-bearing page.
const lastGoodProfile = new Map<string, { username: string | null; avatarUrl: string | null }>()
// Last payload emitted per column, so polling / repeated navigation events don't spam the
// renderer with identical updates.
const lastEmitted = new Map<string, string>()
// Re-entrancy lock: emitAccountInfo is async (DOM/cookie checks), and bursty navigation +
// polling can fire it concurrently for the same column. Overlapping calls don't run in parallel;
// instead they set rerunRequested (below) so the in-flight pass re-runs once it finishes.
const emittingColumns = new Set<string>()
// A call that arrives while a column's emit is in flight isn't dropped: it flags a trailing
// re-run, so e.g. a navigation that lands mid-poll still gets its fresh state emitted instead of
// waiting for the next 4s poll. Concurrent calls collapse to a single trailing re-run.
const rerunRequested = new Set<string>()
// The window that currently owns the process-global IPC handlers. ipcMain.handle is global, so
// on the macOS close→activate→re-create cycle a stale window's `closed` listener could otherwise
// tear down the *new* window's handlers; gate cleanup on identity against this.
let currentWin: BrowserWindow | null = null
// The login-state poll. Module-scoped so a re-invocation of setupIpcHandlers (HMR, window
// re-create) can clear the previous interval instead of leaking it.
let pollTimer: ReturnType<typeof setInterval> | null = null

async function emitAccountInfo(
  columnId: string,
  managedView: ManagedView,
  win: BrowserWindow,
  isLoggedIn: IsLoggedInFn
): Promise<void> {
  if (emittingColumns.has(columnId)) {
    // Don't drop this request — flag a trailing re-run so the in-flight pass re-evaluates with
    // fresh state once it completes (avoids a navigation getting stuck behind a stale poll).
    rerunRequested.add(columnId)
    return
  }
  emittingColumns.add(columnId)
  try {
    const { service } = managedView.descriptor
    const wc = managedView.view.webContents
    if (wc.isDestroyed()) return

    // Only inspect login state / run selectors on the service's own domain. On an unrelated page
    // (e.g. a link the user followed out of the column) the SPA localStorage and DOM selectors
    // return nothing, which would false-positive a logout and clear the cached profile. X is
    // exempt: its detection is cookie-based (session-scoped) and stays valid off-domain.
    if (service !== 'x' && !isOnServiceDomain(wc, service)) return

    const loginState = await isLoggedIn(wc, service)
    // isLoggedIn awaits DOM/cookie checks; the view may have been torn down meanwhile.
    if (wc.isDestroyed()) return

    // Indeterminate (e.g. Threads SPA shell not yet rendered): keep the last emitted state rather
    // than flashing logged-out. did-finish-load and the poll re-check once the DOM settles.
    if (loginState === null) return
    const loggedIn = loginState

    // While a page is still loading the DOM-based checks transiently read as logged-out (the
    // login chrome hasn't rendered yet). Don't emit that false state — did-finish-load and the
    // poll re-check once the page settles, so a real logout is still reported shortly after.
    if (!loggedIn && wc.isLoading()) return

    let username: string | null = null
    let avatarUrl: string | null = null
    if (loggedIn) {
      // Only run the scraper scripts on the service's own domain. X stays logged-in off-domain
      // (cookie-based), but executeJavaScript must never touch an untrusted external page — fall
      // back to the cached handle/avatar there instead.
      let rawUsername: string | null = null
      let scrapedAvatar: string | null = null
      if (isOnServiceDomain(wc, service)) {
        const [u, a] = await Promise.all([
          wc.executeJavaScript(USERNAME_SELECTOR[service]).catch(() => null),
          wc.executeJavaScript(AVATAR_URL_SELECTOR[service]).catch(() => null),
        ])
        rawUsername = u
        scrapedAvatar = a
      }
      // Reject anything that isn't a well-formed handle for this platform (untrusted DOM input).
      const scrapedUsername =
        typeof rawUsername === 'string' && HANDLE_PATTERN[service].test(rawUsername)
          ? rawUsername
          : null
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
  } catch (err) {
    // Callers invoke this as `void emitAccountInfo(...)`, so a throw (e.g. the window/view torn
    // down in the TOCTOU gap before .send) would otherwise surface as an unhandled rejection.
    console.error(`Failed to emit account info for column ${columnId}:`, err)
  } finally {
    emittingColumns.delete(columnId)
    // A call arrived while this pass was in flight — re-run once with fresh state. The lastEmitted
    // dedupe suppresses a redundant send if nothing actually changed.
    if (rerunRequested.delete(columnId) && !win.isDestroyed()) {
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    }
  }
}

// Re-evaluate login state at least this often, to catch sign-outs that happen without a
// navigation event (Bluesky/Threads are SPAs and can clear their session in place).
const ACCOUNT_POLL_INTERVAL_MS = 4000

// Every channel registered via ipcMain.handle below — used to remove prior registrations on
// re-invocation and to tear them down on window close.
const HANDLED_CHANNELS = [
  CHANNELS.NAVIGATE,
  CHANNELS.SET_ACTIVE_COLUMN,
  CHANNELS.GO_BACK,
  CHANNELS.GO_FORWARD,
  CHANNELS.COMPOSE_POST,
  CHANNELS.SET_COLUMN_VISIBLE,
  CHANNELS.CLOSE_COLUMN,
  CHANNELS.REQUEST_ADD_ACCOUNT,
]

function buildNavigationUrl(view: ManagedView, menuKey: MenuKey): string | null {
  const baseUrl = new URL(SNS_URLS[view.descriptor.service])
  const path = NAV_MAP[view.descriptor.service][menuKey]
  // `!path` also rejects an unknown menuKey (undefined) sent from the renderer, which would
  // otherwise throw on path.includes() below.
  if (!path) return null

  const username = view.descriptor.username
  // Re-validate the handle before substituting it into the path. descriptor.username can come
  // from persisted account data (not only the HANDLE_PATTERN-checked scrape), so a malformed
  // value (null, or one containing `..`) must not collapse `:username` to '' / traverse the path.
  if (path.includes(':username')) {
    if (!username || !HANDLE_PATTERN[view.descriptor.service].test(username)) {
      return null
    }
  }

  const resolvedPath = path.replaceAll(':username', username ?? '')
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
  // A new window is taking over the process-global handlers. The close-time cleanup only clears
  // the caches when currentWin still matched the closing window, so if that ordering didn't hold
  // (closed not yet fired / skipped), stale lastEmitted signatures would survive and the dedupe
  // would suppress the new window's initial ACCOUNTS_CHANGED — leaving its UI stuck. Clear here to
  // guarantee a fresh start regardless of close-event ordering.
  if (currentWin !== win) {
    lastGoodProfile.clear()
    lastEmitted.clear()
    emittingColumns.clear()
    rerunRequested.clear()
  }
  currentWin = win
  let activeColumnId: string | null = null

  // ipcMain.handle is process-global; clear any prior registration first so re-invocation
  // (macOS window re-create, main-process HMR) can't throw "second handler" on register.
  for (const channel of HANDLED_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  // Defense-in-depth: these handlers are process-global, so reject invocations whose sender
  // isn't the trusted main-window renderer (the WebContentsViews have no preload/ipcRenderer,
  // but gate on identity regardless). isDestroyed() is checked first so a late IPC after the
  // window closed can't throw "Object has been destroyed" on the win.webContents access.
  ipcMain.handle(CHANNELS.NAVIGATE, (event, columnId: string, menuKey: MenuKey) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    const managedView = viewRegistry.get(columnId)
    if (!managedView || managedView.view.webContents.isDestroyed()) return

    const url = buildNavigationUrl(managedView, menuKey)
    if (!url) return

    managedView.view.webContents.loadURL(url).catch((err) => {
      console.error(`Failed to load URL: ${url}`, err)
    })
  })

  ipcMain.handle(CHANNELS.SET_ACTIVE_COLUMN, (event, columnId: string) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    if (!viewRegistry.has(columnId)) return

    activeColumnId = columnId
    win.webContents.send(CHANNELS.ACTIVE_CHANGED, activeColumnId)
  })

  ipcMain.handle(CHANNELS.GO_BACK, (event, columnId: string) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    const managedView = viewRegistry.get(columnId)
    if (!managedView || managedView.view.webContents.isDestroyed()) return
    if (!managedView.view.webContents.canGoBack()) return

    managedView.view.webContents.goBack()
  })

  ipcMain.handle(CHANNELS.GO_FORWARD, (event, columnId: string) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    const managedView = viewRegistry.get(columnId)
    if (!managedView || managedView.view.webContents.isDestroyed()) return
    if (!managedView.view.webContents.canGoForward()) return

    managedView.view.webContents.goForward()
  })

  ipcMain.handle(CHANNELS.COMPOSE_POST, async (event, service: string) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
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
  // poll login state and let the dedupe in emitAccountInfo suppress no-op updates. Clear any
  // prior interval first so a re-invocation (HMR, window re-create) doesn't leak it.
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    viewRegistry.forEach((managedView, columnId) => {
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })
  }, ACCOUNT_POLL_INTERVAL_MS)

  // ipcMain.handle registrations are process-global. On macOS the window can be closed and
  // re-created (app `activate`), which calls setupIpcHandlers again — so the old handlers must
  // be removed here, otherwise the second registration throws and the per-column state leaks.
  win.on('closed', () => {
    // Only the window that still owns the global handlers/poll may tear them down. If a new
    // window was already created (and re-registered) before this `closed` fired, currentWin
    // points at it — and its setupIpcHandlers already cleared our old interval — so skipping
    // here avoids both unregistering the new window's handlers and clearing its live timer.
    if (currentWin === win) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      // Module-level caches would otherwise carry stale state into a re-created window.
      lastGoodProfile.clear()
      lastEmitted.clear()
      emittingColumns.clear()
      rerunRequested.clear()
      for (const channel of HANDLED_CHANNELS) {
        ipcMain.removeHandler(channel)
      }
      currentWin = null
    }
  })
}
