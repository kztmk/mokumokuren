import {
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

type SidebarProps = {
  columns: ColumnDescriptor[]
  activeColumnId: string | null
  onComposePost: (service: ServiceName) => void
  onRequestAddAccount: (service: ServiceName) => void
}

export function Sidebar({
  columns,
  activeColumnId,
  onComposePost,
  onRequestAddAccount,
}: SidebarProps): React.JSX.Element {
  const activeColumn = columns.find((c) => c.accountId === activeColumnId) ?? columns[0] ?? null
  const activeService: ServiceName | null = activeColumn?.service ?? null

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
            const disabled = isMenuDisabled(activeService, key, activeColumn?.username ?? null)
            const path = NAV_MAP[activeService][key]
            return (
              <button
                key={key}
                disabled={disabled}
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
                  // Phase4: navigate to NAV_MAP[activeService][key]
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
          const loggedIn = col.username !== null
          const badgeColor = SERVICE_META[col.service].badgeColor
          return (
            <div
              key={col.accountId}
              title={
                col.username ? `@${col.username} (${col.service})` : `未ログイン (${col.service})`
              }
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                border: `2px solid ${isActive ? '#1D9BF0' : 'transparent'}`,
                background: loggedIn ? badgeColor : '#444',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 11,
                fontWeight: 'bold',
                boxSizing: 'border-box',
              }}
              onClick={() => {
                // Phase4: setActiveColumn(col.accountId)
              }}
            >
              {col.service[0].toUpperCase()}
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
