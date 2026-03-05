import React, { useState, useEffect, useCallback } from 'react'
import Layout from './components/Layout'
import Board from './components/Kanban/Board'
import CalendarView from './components/Calendar/CalendarView'
import FileBrowser from './components/Content/FileBrowser'
import SkillsManager from './components/Skills/SkillsManager'
import SoulEditor from './components/Soul/SoulEditor'
import CredentialsManager from './components/Credentials/CredentialsManager'
import SettingsPage from './components/Settings/SettingsPage'
import AIProviderPage from './components/Settings/AIProviderPage'
import ChatPage from './components/Chat/ChatPage'
import MemoryManager from './components/Memory/MemoryManager'
import FleetDashboard from './components/Fleet/FleetDashboard'
import EnterpriseOnboarding from './components/Enterprise/EnterpriseOnboarding'
import { TimezoneProvider } from './components/TimezoneContext'
import { ThemeProvider } from './components/ThemeContext'
import { SocketProvider } from './hooks/useSocket.jsx'
import { NavProvider } from './hooks/useNav.jsx'

const VALID_PAGES = new Set(['chat', 'kanban', 'calendar', 'files', 'skills', 'soul', 'credentials', 'settings', 'fleet', 'enterprise'])

function getHashPage() {
  const hash = location.hash.replace('#', '')
  return VALID_PAGES.has(hash) ? hash : 'chat'
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
              {page === 'calendar' && <CalendarView />}
              {page === 'chat' && <ChatPage />}
              {page === 'files' && <FileBrowser />}
              {page === 'skills' && <SkillsManager />}
              {page === 'soul' && <SoulEditor />}
              {page === 'credentials' && <CredentialsManager />}
              {page === 'ai-provider' && <AIProviderPage />}
              {page === 'settings' && <SettingsPage />}
              {page === 'fleet' && <FleetDashboard />}
              {page === 'enterprise' && <EnterpriseOnboarding />}
            </Layout>
          </NavProvider>
        </TimezoneProvider>
      </SocketProvider>
    </ThemeProvider>
  )
}
