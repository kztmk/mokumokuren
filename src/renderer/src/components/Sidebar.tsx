import {
  ACTIVE_BORDER_COLOR,
  type ColumnDescriptor,
  type MenuKey,
  type ServiceName,
  NAV_MAP,
  SERVICE_META,
  isMenuDisabled,
} from '../services'

const NAV_KEYS: MenuKey[] = [
  'home',
  'search',
  'notifications',
  'messages',
  'bookmarks',
  'profile',
  'post',
]

const NAV_LABELS: Record<MenuKey, string> = {
  home: '⌂',
  search: '⌕',
  notifications: '🔔',
  messages: '✉',
  bookmarks: '⊕',
  profile: '◉',
  post: '✎',
}

type AccountInfo = { username: string | null; avatarUrl: string | null; loggedIn: boolean }

type SidebarProps = {
  columns: ColumnDescriptor[]
  activeColumnId: string | null
  accountInfos: Record<string, AccountInfo>
  onNavigate: (columnId: string, menuKey: MenuKey) => void
  onSetActive: (columnId: string) => void
  onComposePost: (service: ServiceName) => void
  onRequestAddAccount: (service: ServiceName) => void
}

export function Sidebar({
  columns,
  activeColumnId,
  accountInfos,
  onNavigate,
  onSetActive,
  onComposePost,
  onRequestAddAccount,
}: SidebarProps): React.JSX.Element {
  const activeColumn = columns.find((c) => c.accountId === activeColumnId) ?? columns[0] ?? null
  const activeService: ServiceName | null = activeColumn?.service ?? null
  const navigableColumnId = activeColumn?.accountId ?? null
  // Prefer the live scraped handle over the startup placeholder so Profile enables after login.
  const activeUsername =
    (activeColumn ? accountInfos[activeColumn.accountId]?.username : null) ??
    activeColumn?.username ??
    null

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 72,
        height: '100vh',
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 100,
        boxSizing: 'border-box',
      }}
    >
      {/* Navigation items */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', flex: 1 }}>
        {activeService !== null &&
          NAV_KEYS.map((key) => {
            const disabled = isMenuDisabled(activeService, key, activeUsername)
            const path = NAV_MAP[activeService][key]
            return (
              <button
                key={key}
                disabled={disabled || navigableColumnId === null}
                title={`${key}${path ? ` (${path})` : ''}`}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  border: 'none',
                  background: 'transparent',
                  color: disabled ? '#444' : '#e7e9ea',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontSize: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={() => {
                  if (navigableColumnId === null || disabled) return
                  onNavigate(navigableColumnId, key)
                }}
              >
                {NAV_LABELS[key]}
              </button>
            )
          })}
      </nav>

      {/* Account icon list (max 10) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          paddingBottom: 8,
        }}
      >
        {columns.slice(0, 10).map((col) => {
          const isActive = col.accountId === activeColumnId
          const info = accountInfos[col.accountId]
          const effectiveUsername = info?.username ?? col.username
          const loggedIn = info?.loggedIn ?? false
          const avatarUrl = info?.avatarUrl ?? null
          const badgeColor = SERVICE_META[col.service].badgeColor
          return (
            <div
              key={col.accountId}
              title={
                loggedIn && effectiveUsername
                  ? `@${effectiveUsername} (${col.service})`
                  : `未ログイン (${col.service})`
              }
              style={{
                position: 'relative',
                width: 36,
                height: 36,
                borderRadius: 18,
                cursor: 'pointer',
                flexShrink: 0,
                boxShadow: isActive
                  ? `0 0 0 3px ${ACTIVE_BORDER_COLOR}, 0 0 6px 1px rgba(255,178,0,0.55)`
                  : 'none',
              }}
              onClick={() => {
                onSetActive(col.accountId)
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 18,
                  background: loggedIn ? badgeColor : '#1f1f1f',
                  color: loggedIn ? '#fff' : '#5a5a5a',
                  fontSize: 11,
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden',
                  opacity: loggedIn ? 1 : 0.4,
                  filter: loggedIn ? 'none' : 'grayscale(100%)',
                  boxShadow:
                    !isActive && loggedIn ? 'inset 0 0 0 1px rgba(255,255,255,0.18)' : 'none',
                }}
              >
                {col.service[0].toUpperCase()}
                {avatarUrl && (
                  <img
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
              {loggedIn && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: '#00BA7C',
                    border: '2px solid #000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 'bold',
                    lineHeight: 1,
                  }}
                >
                  ✓
                </div>
              )}
            </div>
          )
        })}

        {/* Add account button */}
        <button
          title="アカウントを追加"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            border: '2px solid #333',
            background: 'transparent',
            color: '#e7e9ea',
            cursor: 'pointer',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => {
            // Phase4: requestAddAccount stub
            if (activeService !== null) onRequestAddAccount(activeService)
          }}
        >
          +
        </button>
      </div>

      {/* Post button */}
      <button
        title="投稿"
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          border: 'none',
          background: '#1D9BF0',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 20,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={() => {
          // Phase4: composePost stub
          if (activeService !== null) onComposePost(activeService)
        }}
      >
        ✎
      </button>
    </div>
  )
}
