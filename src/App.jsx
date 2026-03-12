import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import Layout from './components/Layout'
import Board from './components/Kanban/Board'
import CalendarView from './components/Calendar/CalendarView'
import SkillsManager from './components/Skills/SkillsManager'
import SoulEditor from './components/Soul/SoulEditor'
import CredentialsManager from './components/Credentials/CredentialsManager'
import SettingsPage from './components/Settings/SettingsPage'
import MemoryManager from './components/Memory/MemoryManager'
import AgentsPage from './components/Agents/AgentsPage'
import ChatPage from './components/Chat/ChatPage'
import FleetDashboard from './components/Fleet/FleetDashboard'

// Heavy page — lazy-loaded so the syntax highlighter bundle is deferred until first use
const FileBrowser = lazy(() => import('./components/Content/FileBrowser'))

import { TimezoneProvider } from './components/TimezoneContext'
import { ThemeProvider } from './components/ThemeContext'
import { SocketProvider } from './hooks/useSocket.jsx'
import { NavProvider } from './hooks/useNav.jsx'

const VALID_PAGES = new Set(['kanban', 'calendar', 'files', 'skills', 'soul', 'credentials', 'settings', 'agents', 'fleet', 'chat'])

function getHashPage() {
  const hash = location.hash.replace('#', '')
  return VALID_PAGES.has(hash) ? hash : 'kanban'
}

export default function App() {
  const [page, setPageRaw] = useState(getHashPage)

  const setPage = useCallback((p) => {
    setPageRaw(p)
    history.pushState(null, '', `#${p}`)
  }, [])

  useEffect(() => {
    const onPop = () => setPageRaw(getHashPage())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <ThemeProvider>
      <SocketProvider>
        <TimezoneProvider>
          <NavProvider setPage={setPage}>
            <Layout page={page} setPage={setPage}>
              {page === 'kanban' && <Board />}
              {page === 'chat' && <ChatPage />}
              {page === 'calendar' && <CalendarView />}
              {page === 'files' && (
                <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading file browser…</div>}>
                  <FileBrowser />
                </Suspense>
              )}
              {page === 'skills' && <SkillsManager />}
              {page === 'soul' && <SoulEditor />}
              {page === 'credentials' && <CredentialsManager />}
              {page === 'agents' && <AgentsPage />}
              {page === 'fleet' && <FleetDashboard />}
              {page === 'settings' && <SettingsPage />}
            </Layout>
          </NavProvider>
        </TimezoneProvider>
      </SocketProvider>
    </ThemeProvider>
  )
}
