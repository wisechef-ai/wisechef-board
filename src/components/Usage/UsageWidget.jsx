import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Zap, ChevronDown, Coins, Hash, Cpu, Key, Trash2 } from 'lucide-react'

function BYOKInput() {
  const [providers, setProviders] = useState({})
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(setProviders).catch(() => {})
  }, [])

  const save = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setProviders(p => ({ ...p, [provider]: { hasKey: true, masked: data.masked } }))
        setApiKey('')
        setMsg('✅ Key saved — usage limits removed')
      } else {
        setMsg('❌ ' + (data.error || 'Failed'))
      }
    } catch { setMsg('❌ Network error') }
    setSaving(false)
    setTimeout(() => setMsg(null), 4000)
  }

  const remove = async (prov) => {
    await fetch(`/api/providers/${prov}`, { method: 'DELETE' })
    setProviders(p => { const n = { ...p }; delete n[prov]; return n })
  }

  const linked = Object.entries(providers).filter(([, v]) => v.hasKey)

  return (
    <div className="space-y-2">
      {linked.length > 0 && (
        <div className="space-y-1">
          {linked.map(([name, v]) => (
            <div key={name} className="flex items-center justify-between bg-secondary/50 rounded px-2 py-1">
              <span className="text-[11px]"><Key size={10} className="inline mr-1 text-emerald-400" />{name} {v.masked}</span>
              <button onClick={() => remove(name)} className="text-red-400 hover:text-red-300"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <select value={provider} onChange={e => setProvider(e.target.value)}
          className="bg-secondary border border-border rounded px-1.5 py-1 text-[11px] text-foreground w-24">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google</option>
        </select>
        <input value={apiKey} onChange={e => setApiKey(e.target.value)}
          placeholder="sk-ant-..." type="password"
          className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground min-w-0"
        />
        <button onClick={save} disabled={saving || !apiKey.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap">
          {saving ? '...' : 'Save'}
        </button>
      </div>
      {msg && <p className="text-[10px] text-emerald-400">{msg}</p>}
    </div>
  )
}

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

function formatCost(n) {
  if (!n) return '$0.00'
  return '$' + n.toFixed(2)
}

function ProgressBar({ label, percent, resetsIn, tokens, cost }) {
  const barColor = percent > 80 ? 'bg-red-500' : percent > 60 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="text-muted-foreground">Resets {resetsIn}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.max(1, percent)}%` }}
          />
        </div>
        <span className="text-[11px] font-medium text-foreground w-10 text-right">{percent}%</span>
      </div>
      {(tokens != null || cost != null) && (
        <div className="flex gap-3 text-[9px] text-muted-foreground">
          {tokens != null && <span className="flex items-center gap-0.5"><Hash size={8} />{formatTokens(tokens)} tokens</span>}
          {cost != null && <span className="flex items-center gap-0.5"><Coins size={8} />{formatCost(cost)}</span>}
        </div>
      )}
    </div>
  )
}

export default function UsageWidget() {
  const [usage, setUsage] = useState(null)
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [restartNote, setRestartNote] = useState(false)

  const fetchUsage = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/usage')
      setUsage(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsage()
    fetch('/api/models').then(r => r.json()).then(setModels).catch(() => {})
    const iv = setInterval(fetchUsage, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [fetchUsage])

  const switchModel = async (model) => {
    try {
      await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      setRestartNote(true)
      fetchUsage()
    } catch {}
  }

  if (!usage) return null

  const displayModel = (usage.model || 'unknown').replace('anthropic/', '').replace('google/', '').replace('openai/', '')
  const tiers = usage.tiers || []
  const sessionPct = tiers[0]?.percent ?? 0

  // Color for collapsed pill
  const pillColor = sessionPct > 80 ? 'text-red-400' : sessionPct > 60 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 sm:gap-2 bg-secondary/50 hover:bg-secondary/70 rounded-full px-2.5 sm:px-4 py-1.5 text-xs transition-colors"
      >
        <Zap size={12} className="text-orange-400 shrink-0" />
        <span className="hidden sm:inline text-muted-foreground text-[10px]">{displayModel}</span>
        <div className="hidden sm:block w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${sessionPct > 80 ? 'bg-red-500' : sessionPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.max(1, sessionPct)}%` }}
          />
        </div>
        <span className={`text-[10px] font-medium ${pillColor}`}>{sessionPct}%</span>
        <ChevronDown size={10} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <div onClick={e => { e.stopPropagation(); fetchUsage(); }} className="hidden sm:block hover:text-orange-400 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </div>
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 bg-card border border-border rounded-lg shadow-xl p-4 z-50 space-y-4">
          {/* Active Model */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Active Model</label>
            <div className="flex items-center gap-2">
              <Cpu size={12} className="text-orange-400" />
              <span className="text-sm font-medium text-foreground">{displayModel}</span>
            </div>
            {models.length > 0 && (
              <select
                value={usage.model}
                onChange={e => switchModel(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-orange-500 mt-1"
              >
                {models.map(m => (
                  <option key={m} value={m}>{m.replace('anthropic/', '').replace('google/', '').replace('openai/', '')}</option>
                ))}
              </select>
            )}
            {restartNote && (
              <p className="text-[10px] text-green-400">Model updated — takes effect on next session</p>
            )}
          </div>

          {/* Usage tiers */}
          <div className="space-y-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Usage</div>
            {tiers.map((tier, i) => (
              <ProgressBar key={tier.label || i} {...tier} />
            ))}
          </div>

          {/* BYOK */}
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Your API Key (optional)</div>
            <p className="text-[10px] text-muted-foreground">Add your own API key for unlimited usage — no caps, no downgrades.</p>
            <BYOKInput />
          </div>
        </div>
      )}
    </div>
  )
}
