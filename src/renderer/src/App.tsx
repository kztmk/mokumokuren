import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { ColumnHeader } from './components/ColumnHeader'
import { ACTIVE_BORDER_COLOR, type ColumnDescriptor } from './services'

const HEADER_H = 40

function App(): React.JSX.Element {
  const [columns, setColumns] = useState<ColumnDescriptor[]>([])
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.onColumnLayout((snap) => {
      setColumns(snap.columns)
      setActiveColumnId((prev) => {
        if (prev === null && snap.columns.length > 0) return snap.columns[0].accountId
        return prev
      })
    })
  }, [])

  const handleSetActive = (columnId: string): void => {
    // Phase4: window.electronAPI.setActiveColumn(columnId)
    setActiveColumnId(columnId)
  }

  const handleClose = (): void => {
    // Phase4: window.electronAPI.closeColumn(columnId)
  }

  const handleSetVisible = (): void => {
    // Phase4: window.electronAPI.setColumnVisible(columnId, visible)
  }

  const handleComposePost = (): void => {
    // Phase4: window.electronAPI.composePost(service)
  }

  const handleRequestAddAccount = (): void => {
    // Phase4: window.electronAPI.requestAddAccount(service)
  }

  return (
    <>
      <Sidebar
        columns={columns}
        activeColumnId={activeColumnId}
        onComposePost={handleComposePost}
        onRequestAddAccount={handleRequestAddAccount}
      />
      {columns.map((col) => {
        const isActive = col.accountId === activeColumnId
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
              onSetActive={handleSetActive}
              onClose={handleClose}
              onSetVisible={handleSetVisible}
            />
          </div>
        )
      })}
    </>
  )
}

export default App
