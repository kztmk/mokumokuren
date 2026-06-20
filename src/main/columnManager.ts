import { WebContentsView, shell, type BrowserWindow } from 'electron'
import { getOrCreateSession, applyUAToSession } from './sessionManager'
import { SNS_URLS, type ServiceName } from '../renderer/src/services'
import type { Account } from './accountStore'

// Single source of truth for the set of live columns (WebContentsViews). Owns creation and
// destruction so columns can be added/removed at runtime (show/hide, account add/delete) rather
// than only at startup. layoutManager reads the ordered list from here; the IPC layer attaches
// its per-column listeners/caches via the hooks below. This module imports neither of those, so
// there is no cycle.
export type ManagedView = {
  view: WebContentsView
  descriptor: {
    accountId: string
    service: ServiceName
    username: string | null
  }
}

// Hosts each service may navigate to in-frame; anything else is opened in the external browser.
const ALLOWED_HOSTS: Record<ServiceName, string[]> = {
  x: ['x.com', 'twitter.com'],
  bluesky: ['bsky.app', 'bsky.social'],
  // Threads migrated its primary domain to threads.com; keep threads.net for the redirect/legacy.
  threads: ['threads.net', 'threads.com', 'instagram.com'],
}

// Lifecycle hooks injected by the entry point to keep this module decoupled: onViewAdded lets the
// IPC layer wire its navigation/login listeners to a new view, onViewRemoved lets it drop that
// column's caches, and onChanged re-applies the layout after the column set changes.
type ColumnHooks = {
  onViewAdded: (mv: ManagedView) => void
  onViewRemoved: (accountId: string) => void
  onChanged: () => void
}

let currentWindow: BrowserWindow | null = null
let hooks: ColumnHooks | null = null
// Ordered left-to-right; index drives column position in the layout.
const orderedViews: ManagedView[] = []
// Same views keyed by accountId for O(1) IPC lookups. Kept in sync with orderedViews. The IPC
// layer holds this exact Map reference, so runtime mutations here are visible to it immediately.
const registry = new Map<string, ManagedView>()

function buildManagedView(account: Account): ManagedView {
  // Guard before creating any resources so we don't leak a WebContentsView if there's no window.
  const win = currentWindow
  if (!win || win.isDestroyed()) {
    throw new Error('columnManager: cannot create a column without an active window')
  }

  const ses = getOrCreateSession({ service: account.service, accountId: account.id })
  applyUAToSession(ses)
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      allowRunningInsecureContent: false,
    },
  })
  win.contentView.addChildView(view)

  const allowedHosts = ALLOWED_HOSTS[account.service] ?? []
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      // Only ever hand http(s) URLs to the OS. Forwarding arbitrary schemes (file:, javascript:,
      // custom protocol handlers) to shell.openExternal is a security risk.
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const { hostname } = parsed
        if (allowedHosts.some((h) => hostname === h || hostname.endsWith('.' + h))) {
          return { action: 'allow' }
        }
        shell.openExternal(url).catch((err) => {
          console.error(`Failed to open external URL: ${url}`, err)
        })
      }
    } catch {
      // invalid URL → deny
    }
    return { action: 'deny' }
  })

  return {
    view,
    descriptor: {
      accountId: account.id,
      service: account.service,
      username: account.username,
    },
  }
}

// Create the view, register it, wire IPC listeners (before load, so did-finish-load fires), then
// start loading the service. atIndex places the column at a specific layout position (used when
// re-showing a hidden column so it returns to its order slot); omitted/out-of-range appends.
function instantiateColumn(account: Account, atIndex?: number): ManagedView {
  const mv = buildManagedView(account)
  if (atIndex === undefined || atIndex < 0 || atIndex >= orderedViews.length) {
    orderedViews.push(mv)
  } else {
    orderedViews.splice(atIndex, 0, mv)
  }
  registry.set(account.id, mv)
  hooks?.onViewAdded(mv)
  mv.view.webContents.loadURL(SNS_URLS[account.service]).catch((err) => {
    console.error(`Failed to load URL for ${account.service}:`, err)
  })
  return mv
}

// Actively close every live view's webContents (orphaned pages would otherwise keep
// running/leaking) and drop all references. Used both when the window closes and when a new
// window re-initializes, so stale views never survive into a new session.
function closeAndClearColumns(): void {
  for (const mv of orderedViews) {
    if (!mv.view.webContents.isDestroyed()) {
      mv.view.webContents.close()
    }
  }
  orderedViews.length = 0
  registry.clear()
}

export function initColumnManager(
  window: BrowserWindow,
  accounts: Account[],
  columnHooks: ColumnHooks
): void {
  currentWindow = window
  hooks = columnHooks
  // Tear everything down when this window closes so the views, the closed BrowserWindow, and the
  // hooks chain it captures can all be GC'd — important on macOS where the process stays resident
  // after the window closes. Guard on identity so a newer window that already took over isn't
  // wiped by a late `closed` from the old one.
  window.on('closed', () => {
    if (currentWindow === window) {
      closeAndClearColumns()
      currentWindow = null
      hooks = null
    }
  })
  // Defensive: if a prior `closed` somehow didn't run before this re-init, clear any stale views
  // so we don't append to them and crash when applyLayout iterates destroyed views.
  closeAndClearColumns()
  for (const account of accounts) instantiateColumn(account)
  // Use the param directly (it's non-null) rather than the module-level `hooks`, whose narrowing
  // TS resets after the intervening calls because the `closed` closure can reassign it.
  columnHooks.onChanged()
}

export function addColumn(account: Account, atIndex?: number): ManagedView {
  const mv = instantiateColumn(account, atIndex)
  hooks?.onChanged()
  return mv
}

export function removeColumn(accountId: string): void {
  const idx = orderedViews.findIndex((mv) => mv.descriptor.accountId === accountId)
  if (idx === -1) return
  const mv = orderedViews[idx]

  // Let the IPC layer drop its per-column caches/active-column reference before teardown.
  hooks?.onViewRemoved(accountId)

  if (currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.contentView.removeChildView(mv.view)
  }
  if (!mv.view.webContents.isDestroyed()) {
    mv.view.webContents.close()
  }

  orderedViews.splice(idx, 1)
  registry.delete(accountId)
  hooks?.onChanged()
}

// Reorder the live columns to match the given account-id order (the visible columns only; hidden
// accounts have no view here). Ids not present are ignored; views not named keep their relative
// order at the end. Re-applies the layout so columns move on screen.
export function reorderColumns(orderedIds: string[]): void {
  const idToIndex = new Map(orderedIds.map((id, index) => [id, index]))
  const orderIndex = (id: string): number => idToIndex.get(id) ?? orderedIds.length
  orderedViews.sort(
    (a, b) => orderIndex(a.descriptor.accountId) - orderIndex(b.descriptor.accountId)
  )
  hooks?.onChanged()
}

export function getOrderedViews(): readonly ManagedView[] {
  return orderedViews
}

export function getViewRegistry(): Map<string, ManagedView> {
  return registry
}
