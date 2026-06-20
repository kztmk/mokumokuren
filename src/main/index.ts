import { app, shell, BrowserWindow, ipcMain, type Session, type WebContents } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getAccounts, type Account } from './accountStore'
import { isEncryptionAvailable } from './safeStorageWrapper'
import { runIsolationHarness } from './isolationHarness'
import { applyLayout, initLayoutManager } from './layoutManager'
import { setupIpcHandlers, broadcastAccounts } from './ipcHandlers'
import { initColumnManager, getViewRegistry } from './columnManager'
import { getInitialWindowBounds, trackWindowState } from './windowState'

// Phase5: a clean install starts with no accounts; the user adds them via the sidebar "+". All
// *visible* accounts get a column on startup (hidden ones keep their session but no view). No cap
// here — the user controls how many columns are shown via the hide toggle.
function getStartupAccounts(): Account[] {
  return getAccounts()
    .filter((account) => account.isVisible)
    .sort((a, b) => a.order - b.order)
}

// Auth detection differs per service:
// - X keeps a usable signal in cookies (auth_token cleared on sign-out).
// - Bluesky (bsky.app) is a client-side AT Protocol SPA: the session lives in the
//   `BSKY_STORAGE` localStorage entry, never in a cookie.
// - Threads/Instagram do NOT clear their auth cookies (sessionid/ds_user_id) on sign-out, so
//   cookie presence can't distinguish login state; we detect the login call-to-action instead.
const AUTH_COOKIE_FILTERS: Record<string, Electron.CookiesGetFilter[]> = {
  x: [{ domain: '.x.com', name: 'auth_token' }],
}

// Reads the persisted Bluesky session and reports whether an account is actively signed in.
// Tokens stay cached in `session.accounts` even after sign-out, so a plain `accessJwt`
// substring check false-positives; gate on the `active`/`currentAccount` markers instead.
const BLUESKY_LOGIN_EXPR = `(() => {
  try {
    const root = JSON.parse(localStorage.getItem('BSKY_STORAGE') || 'null')
    const session = root && root.session
    if (!session) return false
    const current = session.currentAccount
    if (current && current.did && current.accessJwt) return true
    return Array.isArray(session.accounts)
      && session.accounts.some((a) => a && a.active && a.accessJwt)
  } catch {
    return false
  }
})()`

// Threads/Instagram surface a "log in" / "Continue with Instagram" call-to-action only while
// signed out (cookies persist after sign-out, so they're useless here). This is a *tri-state*
// check — true (signed in) / false (signed out) / null (indeterminate). Threads is a client-side
// SPA, so right after did-finish-load the DOM can still be an empty shell; returning false there
// would flash a false logged-out, so we return null and let the caller keep the last known state.
// Primary signals are language-independent (the `/login` route link and the nav `/@handle` link);
// the text checks are an EN/JA fallback for login CTAs that aren't `/login` anchors.
const THREADS_LOGIN_EXPR = `(() => {
  try {
    // Definite logged-out: the login route link (language-independent).
    if (document.querySelector('a[href*="/login"]')) return false
    const candidates = document.querySelectorAll('a, button, [role="button"]')
    // Empty/unrendered SPA shell (about:blank, mid client-render): indeterminate — keep last state.
    if (candidates.length === 0) return null
    for (const el of candidates) {
      const t = (el.textContent || '').trim()
      if (/continue with instagram/i.test(t)) return false
      if (/^log in$/i.test(t)) return false
      if (/^ログイン$/.test(t)) return false
      if (/instagram(で|アカウントで)?(続行|ログイン)/.test(t)) return false
    }
    // Definite logged-in: the app nav exposes the signed-in user's own profile link (/@handle).
    if (document.querySelector('a[href^="/@"]')) return true
    // No logout CTA and no nav profile link — indeterminate (a sub-page like /terms, or the nav
    // not yet rendered). Keep the last known state rather than guessing.
    return null
  } catch {
    return false
  }
})()`

const DOM_LOGIN_EXPR: Record<string, string> = {
  bluesky: BLUESKY_LOGIN_EXPR,
  threads: THREADS_LOGIN_EXPR,
}

async function hasAuthCookie(ses: Session, service: string): Promise<boolean> {
  const filters = AUTH_COOKIE_FILTERS[service] ?? []
  for (const filter of filters) {
    if ((await ses.cookies.get(filter)).length > 0) {
      return true
    }
  }
  return false
}

// Tri-state: true (signed in) / false (signed out) / null (indeterminate — caller should keep the
// last known state rather than emit). Only the DOM-based services can be indeterminate; the
// cookie path is always conclusive.
async function isLoggedIn(wc: WebContents, service: string): Promise<boolean | null> {
  if (wc.isDestroyed()) return false
  try {
    const domExpr = DOM_LOGIN_EXPR[service]
    if (domExpr) {
      // A transient execution failure (mid-navigation/render) is indeterminate, not a logout —
      // return null so the caller keeps the last state instead of flashing logged-out.
      return await wc.executeJavaScript(domExpr, true).catch(() => null)
    }
    return await hasAuthCookie(wc.session, service)
  } catch {
    // wc/session may be destroyed mid-flight; treat as logged out rather than crashing.
    return false
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...getInitialWindowBounds(),
    minWidth: 480,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  trackWindowState(win)

  // setupIpcHandlers holds the (initially empty) registry reference and returns hooks so
  // columnManager can attach/detach a column's IPC listeners as views come and go at runtime.
  const ipc = setupIpcHandlers(getViewRegistry(), win, isLoggedIn)
  initLayoutManager(win)
  initColumnManager(win, getStartupAccounts(), {
    onViewAdded: ipc.registerView,
    onViewRemoved: ipc.unregisterView,
    onChanged: applyLayout,
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    // Only forward http(s) to the OS; never hand off file:/javascript:/custom schemes.
    try {
      const { protocol } = new URL(details.url)
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // invalid URL → deny
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.webContents.on('did-finish-load', () => {
    applyLayout()
    broadcastAccounts(win)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  console.log('[safeStorage] encryption available:', isEncryptionAvailable())

  createWindow()

  if (is.dev) {
    void runIsolationHarness()
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
