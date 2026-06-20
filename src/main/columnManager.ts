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
  currentWindow!.contentView.addChildView(view)

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

export function initColumnManager(
  window: BrowserWindow,
  accounts: Account[],
  columnHooks: ColumnHooks
): void {
  currentWindow = window
  hooks = columnHooks
  // Clear the module-level references when this window closes so the closed BrowserWindow (and the
  // hooks chain it captures) can be GC'd. Guard on identity so a newer window that already took
  // over isn't wiped by a late `closed` from the old one.
  window.on('closed', () => {
    if (currentWindow === window) {
      currentWindow = null
      hooks = null
    }
  })
  // On macOS the window can be closed then re-created (dock click), calling this again. The
  // module-level collections still hold the previous window's views — actively close their
  // webContents (otherwise the orphaned pages keep running/leaking) before clearing, so we don't
  // append to stale entries and crash when applyLayout iterates destroyed views.
  for (const mv of orderedViews) {
    if (!mv.view.webContents.isDestroyed()) {
      mv.view.webContents.close()
    }
  }
  orderedViews.length = 0
  registry.clear()
  for (const account of accounts) instantiateColumn(account)
  hooks.onChanged()
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
  const indexOf = (id: string): number => {
    const i = orderedIds.indexOf(id)
    return i === -1 ? orderedIds.length : i
  }
  orderedViews.sort((a, b) => indexOf(a.descriptor.accountId) - indexOf(b.descriptor.accountId))
  hooks?.onChanged()
}

export function getOrderedViews(): readonly ManagedView[] {
  return orderedViews
}

export function getViewRegistry(): Map<string, ManagedView> {
  return registry
}
