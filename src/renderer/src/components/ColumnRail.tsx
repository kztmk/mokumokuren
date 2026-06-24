import { ACTIVE_BORDER_COLOR, type OverflowTab, SERVICE_META } from '../services'

type AccountInfo = { username: string | null; avatarUrl: string | null; loggedIn: boolean }

type ColumnRailProps = {
  side: 'left' | 'right'
  tabs: OverflowTab[]
  width: number
  // Left rail sits just right of the sidebar; right rail is pinned to the window's right edge.
  leftOffset: number
  activeColumnId: string | null
  accountInfos: Record<string, AccountInfo>
  unreadCounts: Record<string, number>
  onScroll: (delta: number) => void
  onSelect: (columnId: string) => void
}

// Phase 8: a vertical strip of tabs for columns scrolled off one edge. The arrow at the top moves
// the visible window toward this side; clicking a tab reveals + activates that column.
export function ColumnRail({
  side,
  tabs,
  width,
  leftOffset,
  activeColumnId,
  accountInfos,
  unreadCounts,
  onScroll,
  onSelect,
}: ColumnRailProps): React.JSX.Element {
  const isLeft = side === 'left'
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        width,
        ...(isLeft ? { left: leftOffset } : { right: 0 }),
        background: 'var(--sidebar-bg)',
        [isLeft ? 'borderRight' : 'borderLeft']: '1px solid var(--chrome-border)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        paddingTop: 6,
        boxSizing: 'border-box',
      }}
    >
      <button
        title={isLeft ? '左のカラムへ' : '右のカラムへ'}
        onClick={() => onScroll(isLeft ? -1 : 1)}
        style={{
          width: 32,
          height: 28,
          borderRadius: 8,
          border: '1px solid var(--chrome-border)',
          background: 'transparent',
          color: 'var(--chrome-text)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {isLeft ? '◀' : '▶'}
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          // Horizontal/top padding so the active tab's ring isn't clipped — overflowY:auto forces
          // overflowX to auto too (CSS), which would otherwise square off the ring at the edges.
          padding: '4px 6px 8px',
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {tabs.map((tab) => {
          const info = accountInfos[tab.accountId]
          const loggedIn = info?.loggedIn ?? (tab.username !== null && tab.username !== 'proto')
          const avatarUrl = info?.avatarUrl ?? null
          const unread = unreadCounts[tab.accountId] ?? 0
          const isActive = tab.accountId === activeColumnId
          const badgeColor = SERVICE_META[tab.service].badgeColor
          const handle = info?.username ?? tab.username
          return (
            <div
              key={tab.accountId}
              title={
                loggedIn && handle ? `@${handle} (${tab.service})` : `未ログイン (${tab.service})`
              }
              onClick={() => onSelect(tab.accountId)}
              style={{
                position: 'relative',
                width: 34,
                height: 34,
                borderRadius: 17,
                cursor: 'pointer',
                flexShrink: 0,
                boxShadow: isActive
                  ? `0 0 0 2px var(--app-bg), 0 0 0 4px ${ACTIVE_BORDER_COLOR}`
                  : 'none',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 17,
                  background: loggedIn ? badgeColor : 'var(--icon-empty-bg)',
                  color: loggedIn ? '#fff' : 'var(--icon-empty-text)',
                  fontSize: 11,
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  position: 'relative',
                  opacity: loggedIn ? 1 : 0.5,
                  filter: loggedIn ? 'none' : 'grayscale(100%)',
                }}
              >
                {tab.service[0].toUpperCase()}
                {avatarUrl && (
                  <img
                    key={avatarUrl}
                    src={avatarUrl}
                    alt=""
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                )}
              </div>
              {unread > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    minWidth: 15,
                    height: 15,
                    padding: '0 3px',
                    borderRadius: 8,
                    background: '#F4212E',
                    border: '2px solid var(--sidebar-bg)',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 'bold',
                    lineHeight: '15px',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
