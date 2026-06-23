import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { ColumnHeader } from './components/ColumnHeader'
import { AiPanel } from './components/AiPanel'
import {
  ACTIVE_BORDER_COLOR,
  type AccountSummary,
  type AiState,
  type ColumnDescriptor,
  type MenuKey,
  type ServiceName,
  type UpdateStatus,
} from './services'

const HEADER_H = 40
type NavState = { canGoBack: boolean; canGoForward: boolean }
type AccountInfo = { username: string | null; avatarUrl: string | null; loggedIn: boolean }

function App(): React.JSX.Element {
  const [columns, setColumns] = useState<ColumnDescriptor[]>([])
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)
  const [navStates, setNavStates] = useState<Record<string, NavState>>({})
  const [accountInfos, setAccountInfos] = useState<Record<string, AccountInfo>>({})
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [aiState, setAiState] = useState<AiState>({
    available: false,
    reason: 'checking',
    hasUnlockKey: false,
    hasGeminiKey: false,
  })
  const [aiOpen, setAiOpen] = useState(false)
  // In-app updates are macOS-only (Windows is managed by the Microsoft Store).
  const updatesSupported = window.electron?.process?.platform === 'darwin'
  // Ref (not a local var) so the once-only guard survives StrictMode unmount/remount.
  const hasSetInitialActive = useRef(false)
  // Mirror of activeColumnId readable inside the (empty-deps) IPC callbacks below, which would
  // otherwise close over the stale initial value.
  const activeColumnIdRef = useRef<string | null>(null)
  // accountId currently being dragged for column reordering.
  const dragColumnIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Set the initial active column exactly once, outside any state updater, so the IPC
    // side-effect can't run multiple times under StrictMode/concurrent re-invocation.
    // setActive updates the ref synchronously alongside state, so a later IPC callback in the
    // same tick reads the just-set value instead of a stale one left by a deferred effect.
    const setActive = (id: string | null): void => {
      activeColumnIdRef.current = id
      setActiveColumnId(id)
    }

    const unsubscribers = [
      window.electronAPI.onColumnLayout((snap) => {
        setColumns(snap.columns)
        if (snap.columns.length === 0) {
          // All columns gone — allow re-initialization if a layout arrives later.
          hasSetInitialActive.current = false
          setActive(null)
          return
        }
        if (!hasSetInitialActive.current) {
          hasSetInitialActive.current = true
          const initialColumnId = snap.columns[0].accountId
          setActive(initialColumnId)
          window.electronAPI.setActiveColumn(initialColumnId)
          return
        }
        // The active column may have been removed (e.g. column close in a later phase). Fall
        // back to the first column so the selection never points at a non-existent id. IPC stays
        // outside any state updater to keep it single-fire under StrictMode.
        const activeStillExists = snap.columns.some(
          (c) => c.accountId === activeColumnIdRef.current
        )
        if (!activeStillExists) {
          const nextActive = snap.columns[0].accountId
          setActive(nextActive)
          window.electronAPI.setActiveColumn(nextActive)
        }
      }),

      window.electronAPI.onAccountsList((list) => {
        setAccounts(list)
      }),

      window.electronAPI.onUnreadChanged((unread) => {
        setUnreadCounts((prev) => ({ ...prev, [unread.columnId]: unread.count }))
      }),

      window.electronAPI.onUpdateStatus((status) => {
        setUpdateStatus(status)
      }),

      window.electronAPI.onAiState((state) => {
        setAiState(state)
      }),

      window.electronAPI.onActiveChanged((columnId) => {
        setActive(columnId)
      }),

      window.electronAPI.onNavStateChanged((state) => {
        setNavStates((prev) => ({
          ...prev,
          [state.columnId]: {
            canGoBack: state.canGoBack,
            canGoForward: state.canGoForward,
          },
        }))
      }),

      window.electronAPI.onAccountsChanged((info) => {
        setAccountInfos((prev) => ({
          ...prev,
          [info.columnId]: {
            username: info.username,
            avatarUrl: info.avatarUrl,
            loggedIn: info.loggedIn,
          },
        }))
      }),
    ]

    // Listeners are now registered — tell main to push the initial layout + account list. Doing
    // this here (rather than relying on the page-load event) avoids dropping the initial state if
    // the broadcast would otherwise beat listener registration.
    window.electronAPI.rendererReady()
    // Pull the current AI gate state once (the gate may not broadcast until its first check).
    window.electronAPI.getAiState().then(setAiState)

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  const handleSetActive = (columnId: string): void => {
    window.electronAPI.setActiveColumn(columnId)
  }

  const handleNavigate = (columnId: string, menuKey: MenuKey): void => {
    window.electronAPI.navigate(columnId, menuKey)
  }

  const handleGoBack = (columnId: string): void => {
    window.electronAPI.goBack(columnId)
  }

  const handleGoForward = (columnId: string): void => {
    window.electronAPI.goForward(columnId)
  }

  const handleClose = (columnId: string): void => {
    // Account deletion (main shows a confirm dialog, then wipes the session + removes the account).
    window.electronAPI.closeColumn(columnId)
  }

  const handleSetVisible = (columnId: string, visible: boolean): void => {
    window.electronAPI.setColumnVisible(columnId, visible)
  }

  const handleShowColumn = (columnId: string): void => {
    window.electronAPI.setColumnVisible(columnId, true)
  }

  // text を渡すと作成画面を prefill（AI「採用」）。無しなら空エディタ（サイドバーの投稿ボタン）。
  const handleComposePost = (service: ServiceName, text?: string): void => {
    window.electronAPI.composePost(service, text)
  }

  const handleOpenAi = (): void => {
    // Hide column WebContentsViews so the renderer DOM panel shows on top, then revalidate.
    window.electronAPI.setAiOverlay(true)
    window.electronAPI.checkSubscription()
    setAiOpen(true)
  }

  const handleCloseAi = (): void => {
    setAiOpen(false)
    window.electronAPI.setAiOverlay(false)
  }

  const handleRequestAddAccount = (): void => {
    // Main shows a service-picker dialog, then creates the account + column.
    window.electronAPI.requestAddAccount()
  }

  const handleCheckForUpdates = (): void => {
    window.electronAPI.checkForUpdates()
  }

  const handleQuitAndInstall = (): void => {
    window.electronAPI.quitAndInstall()
  }

  const handleColumnDragStart = (columnId: string): void => {
    dragColumnIdRef.current = columnId
  }

  const handleColumnDrop = (targetColumnId: string): void => {
    const sourceId = dragColumnIdRef.current
    dragColumnIdRef.current = null
    if (!sourceId || sourceId === targetColumnId) return

    const ids = columns.map((c) => c.accountId)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetColumnId)
    if (from === -1 || to === -1) return

    ids.splice(from, 1)
    ids.splice(to, 0, sourceId)
    window.electronAPI.reorderColumns(ids)
  }

  const activeColumn = columns.find((c) => c.accountId === activeColumnId) ?? columns[0] ?? null
  const activeService: ServiceName | null = activeColumn?.service ?? null

  return (
    <>
      <Sidebar
        columns={columns}
        accounts={accounts}
        activeColumnId={activeColumnId}
        accountInfos={accountInfos}
        onNavigate={handleNavigate}
        onSetActive={handleSetActive}
        onShowColumn={handleShowColumn}
        onComposePost={handleComposePost}
        onRequestAddAccount={handleRequestAddAccount}
        updatesSupported={updatesSupported}
        updateStatus={updateStatus}
        onCheckForUpdates={handleCheckForUpdates}
        onQuitAndInstall={handleQuitAndInstall}
        aiAvailable={aiState.available}
        onOpenAi={handleOpenAi}
      />
      {aiOpen && (
        <AiPanel
          aiState={aiState}
          activeService={activeService}
          onClose={handleCloseAi}
          onComposePost={handleComposePost}
        />
      )}
      {columns.map((col) => {
        const isActive = col.accountId === activeColumnId
        const navState = navStates[col.accountId] ?? { canGoBack: false, canGoForward: false }
        return (
          <div key={col.accountId}>
            <div
              style={{
                position: 'fixed',
                left: col.x,
                top: HEADER_H,
                width: col.width,
                height: Math.max(0, col.height - HEADER_H),
                backgroundColor: isActive ? ACTIVE_BORDER_COLOR : 'transparent',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            />
            <ColumnHeader
              columnId={col.accountId}
              service={col.service}
              username={col.username}
              x={col.x}
              width={col.width}
              isActive={isActive}
              unread={unreadCounts[col.accountId] ?? 0}
              canGoBack={navState.canGoBack}
              canGoForward={navState.canGoForward}
              onSetActive={handleSetActive}
              onClose={handleClose}
              onSetVisible={handleSetVisible}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              onDragStartColumn={handleColumnDragStart}
              onDropColumn={handleColumnDrop}
            />
          </div>
        )
      })}
    </>
  )
}

export default App
