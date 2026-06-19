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
  threads: ['threads.net', 'instagram.com'],
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
      const { hostname } = new URL(url)
      if (allowedHosts.some((h) => hostname === h || hostname.endsWith('.' + h))) {
        return { action: 'allow' }
      }
    } catch {
      // invalid URL → deny
    }
    shell.openExternal(url)
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
// start loading the service. Layout is applied by the caller so a batch of inserts re-lays out once.
function instantiateColumn(account: Account): ManagedView {
  const mv = buildManagedView(account)
  orderedViews.push(mv)
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
  for (const account of accounts) instantiateColumn(account)
  hooks.onChanged()
}

export function addColumn(account: Account): ManagedView {
  const mv = instantiateColumn(account)
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

export function getOrderedViews(): readonly ManagedView[] {
  return orderedViews
}

export function getViewRegistry(): Map<string, ManagedView> {
  return registry
}
