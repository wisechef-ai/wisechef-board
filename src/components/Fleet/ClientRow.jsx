import React, { useState } from 'react'
import { Rocket, Terminal, Trash2 } from 'lucide-react'

function StatusDot({ ok }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
}

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function ClientRow({ client, onRefresh }) {
  const [deploying, setDeploying] = useState(false)
  const h = client.health || {}

  const handleDeploy = async () => {
    if (!confirm(`Deploy update to ${client.name}?`)) return
    setDeploying(true)
    try {
      await fetch(`/api/fleet/${client.id}/deploy`, { method: 'POST' })
      setTimeout(onRefresh, 3000)
    } catch (e) {
      alert('Deploy failed: ' + e.message)
    } finally {
      setDeploying(false)
    }
  }

  const subdomain = client.tunnel?.hostname || `${client.id}.wisechef.ai`

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2.5">
        <div className="font-medium">{client.name}</div>
        <div className="text-xs text-muted-foreground">{client.plan || 'starter'}</div>
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell">
        <a href={`https://${subdomain}`} target="_blank" rel="noopener" className="text-xs text-primary hover:underline">
          {subdomain}
        </a>
      </td>
      <td className="px-3 py-2.5 text-center"><StatusDot ok={h.vpsReachable} /></td>
      <td className="px-3 py-2.5 text-center"><StatusDot ok={h.boardReachable} /></td>
      <td className="px-3 py-2.5 text-center hidden sm:table-cell"><StatusDot ok={h.gatewayStatus} /></td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <span className="text-xs font-mono text-muted-foreground">{h.boardVersion?.slice(0, 7) || '—'}</span>
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <span className="text-xs text-muted-foreground">{timeAgo(h.lastActive)}</span>
      </td>
      <td className="px-3 py-2.5 text-right hidden sm:table-cell">
        <span className="text-xs">€{(h.monthlyCost || 3.49).toFixed(2)}</span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={handleDeploy}
            disabled={deploying}
            title="Deploy Update"
            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          >
            <Rocket size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}
