import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { ColumnHeader } from './components/ColumnHeader'
import type { ColumnDescriptor } from './services'

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
      {columns.map((col) => (
        <ColumnHeader
          key={col.accountId}
          columnId={col.accountId}
          service={col.service}
          username={col.username}
          x={col.x}
          width={col.width}
          isActive={col.accountId === activeColumnId}
          onSetActive={handleSetActive}
          onClose={handleClose}
          onSetVisible={handleSetVisible}
        />
      ))}
    </>
  )
}

export default App
