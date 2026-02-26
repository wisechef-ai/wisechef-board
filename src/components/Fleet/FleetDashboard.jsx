import React, { useState, useEffect, useCallback } from 'react'
import ClientRow from './ClientRow'
import { RefreshCw } from 'lucide-react'

export default function FleetDashboard() {
  const [fleet, setFleet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastCheck, setLastCheck] = useState(null)

  const fetchFleet = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/fleet')
      const data = await res.json()
      setFleet(data.clients || [])
      setLastCheck(data.lastCheck)
    } catch (e) {
      console.error('Failed to fetch fleet:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchFleet() }, [fetchFleet])

  // WebSocket updates
  useEffect(() => {
    if (!window.__socket) return
    const handler = (data) => {
      setFleet(prev => {
        if (!prev) return prev
        return prev.map(c => ({
          ...c,
          health: data[c.id] || c.health,
        }))
      })
      setLastCheck(new Date().toISOString())
    }
    window.__socket.on('fleet:update', handler)
    return () => window.__socket.off('fleet:update', handler)
  }, [])

  const deployed = fleet?.filter(c => c.status === 'deployed') || []
  const other = fleet?.filter(c => c.status !== 'deployed') || []
  const totalCost = deployed.reduce((sum, c) => sum + (c.health?.monthlyCost || 3.49), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Fleet Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            {deployed.length} active · €{totalCost.toFixed(2)}/mo
            {lastCheck && ` · Last check: ${new Date(lastCheck).toLocaleTimeString()}`}
          </p>
        </div>
        <button
          onClick={fetchFleet}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && !fleet && (
        <div className="text-center py-12 text-muted-foreground">Loading fleet data...</div>
      )}

      {fleet && deployed.length === 0 && other.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No clients in registry</div>
      )}

      {deployed.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-2 font-medium">Client</th>
                <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Subdomain</th>
                <th className="text-center px-3 py-2 font-medium">VPS</th>
                <th className="text-center px-3 py-2 font-medium">Board</th>
                <th className="text-center px-3 py-2 font-medium hidden sm:table-cell">Gateway</th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Version</th>
                <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Last Active</th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Cost</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {deployed.map(client => (
                <ClientRow key={client.id} client={client} onRefresh={fetchFleet} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {other.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Other ({other.length})</h3>
          <div className="space-y-1">
            {other.map(c => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground border border-border rounded-md">
                <span className="font-medium text-foreground">{c.name}</span>
                <span className="text-xs px-1.5 py-0.5 bg-muted rounded">{c.status}</span>
                <span className="text-xs">{c.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
