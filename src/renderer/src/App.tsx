import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { ColumnHeader } from './components/ColumnHeader'
import {
  ACTIVE_BORDER_COLOR,
  type AccountSummary,
  type ColumnDescriptor,
  type MenuKey,
  type ServiceName,
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

  const handleComposePost = (service: ServiceName): void => {
    window.electronAPI.composePost(service)
  }

  const handleRequestAddAccount = (): void => {
    // Main shows a service-picker dialog, then creates the account + column.
    window.electronAPI.requestAddAccount()
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
      />
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
