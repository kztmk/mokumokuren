import {
  ACTIVE_BORDER_COLOR,
  type AccountSummary,
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
  accounts: AccountSummary[]
  activeColumnId: string | null
  accountInfos: Record<string, AccountInfo>
  onNavigate: (columnId: string, menuKey: MenuKey) => void
  onSetActive: (columnId: string) => void
  onShowColumn: (columnId: string) => void
  onComposePost: (service: ServiceName) => void
  onRequestAddAccount: () => void
}

export function Sidebar({
  columns,
  accounts,
  activeColumnId,
  accountInfos,
  onNavigate,
  onSetActive,
  onShowColumn,
  onComposePost,
  onRequestAddAccount,
}: SidebarProps): React.JSX.Element {
  const activeColumn = columns.find((c) => c.accountId === activeColumnId) ?? columns[0] ?? null
  const activeService: ServiceName | null = activeColumn?.service ?? null
  const navigableColumnId = activeColumn?.accountId ?? null
  // Prefer the live scraped handle. Only fall back to the startup placeholder before login
  // state is known — once we know the account is logged out, don't resurrect 'proto'.
  const activeInfo = activeColumn ? accountInfos[activeColumn.accountId] : null
  const activeUsername =
    activeInfo?.username ?? (activeInfo?.loggedIn === false ? null : activeColumn?.username) ?? null

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 72,
        height: '100vh',
        background: 'var(--sidebar-bg)',
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
                  color: disabled ? 'var(--chrome-text-disabled)' : 'var(--chrome-text)',
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
        {accounts.slice(0, 10).map((acc) => {
          const badgeColor = SERVICE_META[acc.service].badgeColor

          // Hidden account: session preserved but no live column. Render a dimmed, dashed icon
          // that re-shows the column on click (rather than activating it).
          if (!acc.isVisible) {
            return (
              <div
                key={acc.id}
                title={`${acc.displayName || acc.service}（非表示 — クリックで表示）`}
                onClick={() => onShowColumn(acc.id)}
                style={{
                  position: 'relative',
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 18,
                    background: 'var(--icon-empty-bg)',
                    color: 'var(--icon-empty-text)',
                    fontSize: 11,
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    opacity: 0.4,
                    filter: 'grayscale(100%)',
                    border: '1px dashed var(--chrome-border)',
                  }}
                >
                  {acc.service[0].toUpperCase()}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: 'var(--chrome-border)',
                    border: '2px solid var(--sidebar-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--chrome-text-muted)',
                    fontSize: 9,
                    fontWeight: 'bold',
                    lineHeight: 1,
                  }}
                >
                  ▸
                </div>
              </div>
            )
          }

          const isActive = acc.id === activeColumnId
          const info = accountInfos[acc.id]
          const effectiveUsername = info?.username ?? acc.username
          // Before the first account-info update arrives, fall back to the persisted login
          // state (a real username, not the startup 'proto' placeholder) so accounts don't
          // briefly flash logged-out on startup.
          const loggedIn = info?.loggedIn ?? (acc.username !== null && acc.username !== 'proto')
          const avatarUrl = info?.avatarUrl ?? null
          return (
            <div
              key={acc.id}
              title={
                loggedIn && effectiveUsername
                  ? `@${effectiveUsername} (${acc.service})`
                  : `未ログイン (${acc.service})`
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
                onSetActive(acc.id)
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 18,
                  background: loggedIn ? badgeColor : 'var(--icon-empty-bg)',
                  color: loggedIn ? '#fff' : 'var(--icon-empty-text)',
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
                {acc.service[0].toUpperCase()}
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
                    border: '2px solid var(--sidebar-bg)',
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
            border: '2px solid var(--chrome-border)',
            background: 'transparent',
            color: 'var(--chrome-text)',
            cursor: 'pointer',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => {
            // Always available — main shows the service picker (works even with no accounts yet).
            onRequestAddAccount()
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
