#!/bin/bash
# Patch VidClaw dashboard with WiseChef onboarding wizard
# Runs ON the client VPS after addon files are uploaded to /opt/wisechef/addon/
set -euo pipefail

DASHBOARD="/opt/wisechef/dashboard"

echo "🎨 Patching VidClaw with onboarding wizard..."

# 1. Copy components
mkdir -p "$DASHBOARD/src/components/Onboarding"
cp /opt/wisechef/addon/OnboardingWizard.jsx "$DASHBOARD/src/components/Onboarding/OnboardingWizard.jsx"
cp /opt/wisechef/addon/onboarding-routes.js "$DASHBOARD/server/controllers/onboarding.js"
echo "   ✅ Files copied"

# 2. Patch server routes (add import + use)
if ! grep -q "onboarding" "$DASHBOARD/server/routes.js"; then
    # Add import after last existing import
    sed -i '/^import.*vidclaw/a import onboardingRouter from "./controllers/onboarding.js";' "$DASHBOARD/server/routes.js"
    # Add router.use before SPA fallback
    sed -i '/SPA fallback/i // Onboarding\nrouter.use(onboardingRouter);\n' "$DASHBOARD/server/routes.js"
    echo "   ✅ Routes patched"
fi

# 3. Rewrite App.jsx with onboarding wrapper
cp "$DASHBOARD/src/App.jsx" "$DASHBOARD/src/App.jsx.bak"
cat > "$DASHBOARD/src/App.jsx" << 'APPEOF'
import React, { useState, useEffect } from 'react'
import Layout from './components/Layout'
import Board from './components/Kanban/Board'
import CalendarView from './components/Calendar/CalendarView'
import FileBrowser from './components/Content/FileBrowser'
import SkillsManager from './components/Skills/SkillsManager'
import SoulEditor from './components/Soul/SoulEditor'
import SettingsPage from './components/Settings/SettingsPage'
import { TimezoneProvider } from './components/TimezoneContext'
import { ThemeProvider } from './components/ThemeContext'
import { SocketProvider } from './hooks/useSocket.jsx'
import OnboardingWizard from './components/Onboarding/OnboardingWizard'

export default function App() {
  const [page, setPage] = useState('kanban')
  const [onboarded, setOnboarded] = useState(null)

  useEffect(() => {
    fetch('/api/onboarding/status')
      .then(r => r.json())
      .then(d => setOnboarded(d.onboarded))
      .catch(() => setOnboarded(true))
  }, [])

  if (onboarded === null) return null
  if (onboarded === false) return <OnboardingWizard onComplete={() => setOnboarded(true)} />

  return (
    <ThemeProvider>
      <SocketProvider>
        <TimezoneProvider>
          <Layout page={page} setPage={setPage}>
            {page === 'kanban' && <Board />}
            {page === 'calendar' && <CalendarView />}
            {page === 'files' && <FileBrowser />}
            {page === 'skills' && <SkillsManager />}
            {page === 'soul' && <SoulEditor />}
            {page === 'settings' && <SettingsPage />}
          </Layout>
        </TimezoneProvider>
      </SocketProvider>
    </ThemeProvider>
  )
}
APPEOF
echo "   ✅ App.jsx rewritten"

# 4. Install deps if needed + rebuild
cd "$DASHBOARD"
npm install --production=false 2>&1 | tail -1
npx vite build 2>&1 | tail -3
echo "   ✅ Dashboard rebuilt"

# 5. Install systemd service
cat > /etc/systemd/system/wisechef-dashboard.service << 'SVCEOF'
[Unit]
Description=WiseChef Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wisechef/dashboard
ExecStart=/usr/bin/node server.js
Environment=HOST=127.0.0.1
Environment=PORT=3333
Environment=WISECHEF_WORKSPACE=/opt/wisechef/clawd
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable wisechef-dashboard
systemctl restart wisechef-dashboard
sleep 2

if systemctl is-active wisechef-dashboard >/dev/null 2>&1; then
    echo "   ✅ Dashboard service running"
else
    echo "   ❌ Dashboard service failed"
    journalctl -u wisechef-dashboard --no-pager -n 5
fi

echo "✅ Onboarding wizard installed!"
