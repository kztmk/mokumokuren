import { app, shell, BrowserWindow, ipcMain, WebContentsView, type Session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getOrCreateSession, applyUAToSession, type ServiceName } from './sessionManager'
import { addAccount, getAccounts, type Account } from './accountStore'
import { isEncryptionAvailable } from './safeStorageWrapper'
import { runIsolationHarness } from './isolationHarness'
import { applyLayout, initLayoutManager } from './layoutManager'
import { setupIpcHandlers } from './ipcHandlers'

const SNS_URLS: Record<ServiceName, string> = {
  x: 'https://x.com',
  bluesky: 'https://bsky.app',
  threads: 'https://www.threads.net',
}

const ALLOWED_HOSTS: Record<ServiceName, string[]> = {
  x: ['x.com', 'twitter.com'],
  bluesky: ['bsky.app', 'bsky.social'],
  threads: ['threads.net', 'instagram.com'],
}

const PROTOTYPE_ACCOUNTS: Parameters<typeof addAccount>[0][] = [
  {
    service: 'x',
    displayName: 'X Proto',
    username: 'proto',
    avatarUrl: '',
    order: 0,
    isVisible: true,
  },
  {
    service: 'bluesky',
    displayName: 'Bluesky Proto',
    username: 'proto',
    avatarUrl: '',
    order: 1,
    isVisible: true,
  },
  {
    service: 'threads',
    displayName: 'Threads Proto',
    username: 'proto',
    avatarUrl: '',
    order: 2,
    isVisible: true,
  },
]

function getStartupAccounts(): Account[] {
  const accounts = getAccounts()
  const startupAccounts =
    accounts.length > 0 ? accounts : PROTOTYPE_ACCOUNTS.map((account) => addAccount(account))

  return startupAccounts
    .filter((account) => account.isVisible)
    .sort((a, b) => a.order - b.order)
    .slice(0, 3)
}

async function isLoggedIn(ses: Session, service: string): Promise<boolean> {
  const cookieFilters: Record<string, Electron.CookiesGetFilter[]> = {
    x: [{ domain: '.x.com', name: 'auth_token' }],
    bluesky: [
      { domain: '.bsky.app', name: 'skyware-session' },
      { domain: '.bsky.app', name: '_bsky_token' },
    ],
    threads: [{ domain: '.threads.net', name: 'sessionid' }],
  }

  const filters = cookieFilters[service] ?? []

  for (const filter of filters) {
    if ((await ses.cookies.get(filter)).length > 0) {
      return true
    }
  }

  return false
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  const views = getStartupAccounts().map((account) => {
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
    void isLoggedIn(ses, account.service)
    view.webContents.loadURL(SNS_URLS[account.service])
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
  })

  const viewRegistry = new Map(
    views.map((managedView) => [managedView.descriptor.accountId, managedView])
  )
  setupIpcHandlers(viewRegistry, win)
  initLayoutManager(win, views)

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.webContents.on('did-finish-load', () => applyLayout())
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
