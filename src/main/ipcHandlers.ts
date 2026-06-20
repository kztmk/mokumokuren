import { ipcMain, dialog, type BrowserWindow, type WebContents } from 'electron'
import { CHANNELS } from '../shared/channels'
import {
  COMPOSE_URL,
  NAV_MAP,
  POST_TRIGGER,
  SERVICE_META,
  SNS_URLS,
  type MenuKey,
  type ServiceName,
} from '../renderer/src/services'
import {
  addColumn,
  removeColumn,
  reorderColumns,
  getOrderedViews,
  type ManagedView,
} from './columnManager'
import {
  getAccounts,
  getAccountById,
  addAccount,
  updateAccount,
  updateAccountsOrder,
  removeAccount,
} from './accountStore'
import { clearSessionData } from './sessionManager'

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
  // Threads migrated its primary domain to threads.com; keep threads.net for the redirect/legacy.
  threads: ['threads.net', 'threads.com', 'instagram.com'],
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

type ViewRegistry = Map<string, ManagedView>

// Tri-state: true / false / null. null means "indeterminate" (e.g. the Threads SPA shell hasn't
// rendered yet) — emitAccountInfo skips emitting so the last known state holds.
type IsLoggedInFn = (wc: WebContents, service: string) => Promise<boolean | null>

// Returned by setupIpcHandlers so columnManager can wire/teardown a column's listeners and caches
// when views are added or removed at runtime.
export type IpcController = {
  registerView: (mv: ManagedView) => void
  unregisterView: (accountId: string) => void
}

// Modifier for the column-switch shortcuts: Cmd on macOS, Ctrl elsewhere.
function hasColumnSwitchModifier(input: Electron.Input): boolean {
  return process.platform === 'darwin' ? input.meta : input.control
}

// Push the full account list (visible + hidden), order-sorted, to the renderer. Called on startup
// and after any account mutation (visibility toggle, and — later phases — add/delete/reorder) so
// the sidebar can render hidden accounts and offer them for re-showing.
export function broadcastAccounts(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const summaries = getAccounts()
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((a) => ({
      id: a.id,
      service: a.service,
      displayName: a.displayName,
      username: a.username,
      isVisible: a.isVisible,
      order: a.order,
    }))
  win.webContents.send(CHANNELS.ACCOUNTS_LIST, summaries)
}

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
  CHANNELS.REORDER_COLUMNS,
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
): IpcController {
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

  // Set the active column and notify the renderer. Shared by the IPC handler (sidebar/header
  // clicks) and the keyboard shortcuts below.
  const activateColumn = (columnId: string): void => {
    if (win.isDestroyed() || !viewRegistry.has(columnId)) return
    activeColumnId = columnId
    win.webContents.send(CHANNELS.ACTIVE_CHANGED, activeColumnId)
  }

  // Cmd/Ctrl+1..9 select the 1st..9th column; Cmd/Ctrl+0 selects the 10th. Returns true when the
  // input was a column-switch shortcut (so the caller can preventDefault). Handled via
  // before-input-event on every webContents so it works regardless of which view has focus.
  const handleColumnShortcut = (input: Electron.Input): boolean => {
    if (input.type !== 'keyDown' || !hasColumnSwitchModifier(input)) return false
    if (!/^[0-9]$/.test(input.key)) return false
    const index = input.key === '0' ? 9 : Number(input.key) - 1
    const views = getOrderedViews()
    if (index < views.length) activateColumn(views[index].descriptor.accountId)
    return true
  }

  // ipcMain.handle is process-global; clear any prior registration first so re-invocation
  // (macOS window re-create, main-process HMR) can't throw "second handler" on register.
  for (const channel of HANDLED_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  // Shortcuts pressed while the sidebar/renderer has focus.
  win.webContents.on('before-input-event', (event, input) => {
    if (handleColumnShortcut(input)) event.preventDefault()
  })

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
    activateColumn(columnId)
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

  ipcMain.handle(CHANNELS.SET_COLUMN_VISIBLE, (event, columnId: string, visible: boolean) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    const account = getAccountById(columnId)
    if (!account || account.isVisible === visible) return

    // Persist first so the column set survives restart and the order-position computation below
    // sees the new visibility.
    updateAccount(columnId, { isVisible: visible })

    if (visible) {
      const updated = getAccountById(columnId)
      if (updated) {
        // Re-insert at the account's order position among the now-visible accounts (not appended),
        // so a re-shown column returns to where it belongs. The view is recreated from the
        // persisted session, so the login state is preserved.
        const insertIndex = getAccounts()
          .filter((a) => a.isVisible)
          .sort((a, b) => a.order - b.order)
          .findIndex((a) => a.id === columnId)
        addColumn(updated, insertIndex === -1 ? undefined : insertIndex)
      }
    } else {
      // Destroys the WebContentsView but leaves the persisted session on disk intact.
      removeColumn(columnId)
    }

    broadcastAccounts(win)
  })

  ipcMain.handle(CHANNELS.CLOSE_COLUMN, async (event, columnId: string) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    const account = getAccountById(columnId)
    if (!account) return

    // Confirm before a destructive, irreversible delete (removes the persisted session too).
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['キャンセル', '削除'],
      defaultId: 0,
      cancelId: 0,
      title: 'アカウントを削除',
      message: `「${account.displayName || account.service}」を削除しますか？`,
      detail:
        'このアカウントのログイン情報・セッションデータも完全に削除されます。この操作は取り消せません。',
    })
    if (response !== 1) return
    if (win.isDestroyed()) return

    // Tear down the live column (no-op if the account was hidden), wipe its on-disk session, then
    // drop it from the store and tell the renderer. A session-wipe failure (locked files, etc.)
    // must not strand the account in the store, so always proceed to removeAccount.
    removeColumn(columnId)
    try {
      await clearSessionData({ service: account.service, accountId: account.id })
    } catch (err) {
      console.error(`Failed to clear session data for account ${columnId}:`, err)
    }
    removeAccount(columnId)
    if (!win.isDestroyed()) broadcastAccounts(win)
  })

  ipcMain.handle(CHANNELS.REQUEST_ADD_ACCOUNT, async (event) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return

    // Pick the service via a native dialog, then create the account and spawn its column. The new
    // column has an empty session, so loading the service URL lands on its login page.
    const services: ServiceName[] = ['x', 'bluesky', 'threads']
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [...services.map((s) => SERVICE_META[s].label), 'キャンセル'],
      cancelId: services.length,
      defaultId: 0,
      title: 'アカウントを追加',
      message: '追加するサービスを選択してください',
    })
    if (response < 0 || response >= services.length) return
    if (win.isDestroyed()) return

    const service = services[response]
    const maxOrder = getAccounts().reduce((max, a) => Math.max(max, a.order), -1)
    const account = addAccount({
      service,
      displayName: SERVICE_META[service].label,
      username: null,
      avatarUrl: null,
      order: maxOrder + 1,
      isVisible: true,
    })
    addColumn(account)
    broadcastAccounts(win)
  })

  ipcMain.handle(CHANNELS.REORDER_COLUMNS, (event, orderedVisibleIds: string[]) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    if (!Array.isArray(orderedVisibleIds)) return

    // Only the dragged visible columns define the new sequence; hidden accounts keep their
    // relative order and follow. Persist sequential `order` for all accounts so the arrangement
    // survives restart, then reorder the live views to match and re-broadcast. Dedupe first so a
    // malformed payload with repeated ids can't produce duplicate/conflicting order writes.
    const uniqueIds = Array.from(new Set(orderedVisibleIds))
    const validIds = uniqueIds.filter((id) => getAccountById(id)?.isVisible)
    if (validIds.length === 0) return
    const hidden = getAccounts()
      .filter((a) => !validIds.includes(a.id))
      .sort((a, b) => a.order - b.order)

    const finalOrder = [...validIds, ...hidden.map((a) => a.id)]
    updateAccountsOrder(finalOrder)

    reorderColumns(validIds)
    broadcastAccounts(win)
  })

  // Wire a single column's navigation/login listeners. Called for every existing view at setup
  // and again by columnManager whenever a column is added at runtime.
  const registerView = (managedView: ManagedView): void => {
    const columnId = managedView.descriptor.accountId
    const wc = managedView.view.webContents

    const sendNavState = (): void => {
      if (win.isDestroyed() || wc.isDestroyed()) return
      win.webContents.send(CHANNELS.NAV_STATE_CHANGED, {
        columnId,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
      })
    }

    wc.on('did-navigate', () => {
      sendNavState()
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })
    wc.on('did-finish-load', () => {
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })
    wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (!isMainFrame) return
      sendNavState()
      void emitAccountInfo(columnId, managedView, win, isLoggedIn)
    })
    // Column-switch shortcuts pressed while this view (an SNS page) has focus.
    wc.on('before-input-event', (event, input) => {
      if (handleColumnShortcut(input)) event.preventDefault()
    })
    // Unread count: SNS pages prefix the document title with "(N)". Parse it and surface the
    // number on the column header.
    wc.on('page-title-updated', (_event, title) => {
      if (win.isDestroyed()) return
      const match = /\((\d+)\)/.exec(title)
      const count = match ? Number(match[1]) : 0
      win.webContents.send(CHANNELS.UNREAD_CHANGED, { columnId, count })
    })
  }

  // Drop a removed column's per-column state. Its webContents is destroyed by columnManager, which
  // takes its listeners with it, so only the caches and active-column reference need clearing.
  const unregisterView = (accountId: string): void => {
    lastGoodProfile.delete(accountId)
    lastEmitted.delete(accountId)
    emittingColumns.delete(accountId)
    rerunRequested.delete(accountId)
    if (activeColumnId === accountId) activeColumnId = null
  }

  // Attach to any views that already exist (none at first setup; columnManager registers each as
  // it instantiates them).
  viewRegistry.forEach((managedView) => registerView(managedView))

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

  return { registerView, unregisterView }
}
