import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryWarning, ChevronDown, Cpu, Key, Trash2, Infinity } from 'lucide-react'

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
        setMsg('✅ Key saved — unlimited usage activated!')
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
          placeholder="API key..." type="password"
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

function BatteryIcon({ percent, byok }) {
  if (byok) return <BatteryFull size={14} className="text-emerald-400" />
  if (percent > 60) return <BatteryFull size={14} className="text-emerald-400" />
  if (percent > 30) return <BatteryCharging size={14} className="text-amber-400" />
  if (percent > 10) return <BatteryLow size={14} className="text-orange-400" />
  return <BatteryWarning size={14} className="text-red-400" />
}

function BatteryBar({ percent, byok, credits, maxCredits, hoursToFull, rechargePerHour }) {
  const barColor = byok ? 'bg-emerald-500' :
    percent > 60 ? 'bg-emerald-500' :
    percent > 30 ? 'bg-amber-500' :
    percent > 10 ? 'bg-orange-500' : 'bg-red-500'

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <BatteryIcon percent={percent} byok={byok} />
          <span className="text-sm font-medium text-foreground">
            {byok ? '∞ Unlimited' : `${credits}/${maxCredits} credits`}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {byok ? 'BYOK active' :
           hoursToFull === 0 ? '⚡ Fully charged' :
           `+${rechargePerHour}/hr · full in ~${hoursToFull}h`}
        </span>
      </div>

      <div className="h-3 bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>

      {!byok && percent <= 20 && percent > 0 && (
        <p className="text-[10px] text-amber-400">
          ⚡ Battery low — recharging {rechargePerHour} credit/hour. Add your own API key below for unlimited usage.
        </p>
      )}
      {!byok && percent === 0 && (
        <p className="text-[10px] text-red-400">
          🔋 Battery empty! Next credit in ~1 hour. Add your own API key for unlimited usage.
        </p>
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
    const iv = setInterval(fetchUsage, 60 * 1000) // refresh every minute for battery updates
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

  const bat = usage.battery || {}
  const byok = usage.byok
  const percent = byok ? 100 : (bat.percent ?? 100)

  // Compact model display
  const displayModel = (usage.model || 'unknown')
    .replace('openrouter/', '')
    .replace('anthropic/', '')
    .replace('google/', '')
    .replace('openai/', '')

  // Color for collapsed pill
  const pillColor = byok ? 'text-emerald-400' :
    percent > 60 ? 'text-emerald-400' :
    percent > 30 ? 'text-amber-400' :
    percent > 10 ? 'text-orange-400' : 'text-red-400'

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 sm:gap-2 bg-secondary/50 hover:bg-secondary/70 rounded-full px-2.5 sm:px-4 py-1.5 text-xs transition-colors"
      >
        <BatteryIcon percent={percent} byok={byok} />
        <span className="hidden sm:inline text-muted-foreground text-[10px]">{displayModel}</span>
        <div className="hidden sm:block w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              percent > 60 ? 'bg-emerald-500' : percent > 30 ? 'bg-amber-500' : percent > 10 ? 'bg-orange-500' : 'bg-red-500'
            }`}
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
        <span className={`text-[10px] font-medium ${pillColor}`}>
          {byok ? '∞' : `${percent}%`}
        </span>
        <ChevronDown size={10} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <div onClick={e => { e.stopPropagation(); fetchUsage(); }} className="hidden sm:block hover:text-emerald-400 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </div>
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 bg-card border border-border rounded-lg shadow-xl p-4 z-50 space-y-4">
          {/* Battery */}
          <BatteryBar
            percent={percent}
            byok={byok}
            credits={bat.credits}
            maxCredits={bat.maxCredits}
            hoursToFull={bat.hoursToFull}
            rechargePerHour={bat.rechargePerHour}
          />

          {/* Active Model */}
          <div className="space-y-1 border-t border-border pt-3">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Active Model</label>
            <div className="flex items-center gap-2">
              <Cpu size={12} className="text-orange-400" />
              <span className="text-sm font-medium text-foreground">{displayModel}</span>
            </div>
            {models.length > 0 && (
              <select
                value={usage.model}
                onChange={e => switchModel(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-emerald-500 mt-1"
              >
                {models.map(m => (
                  <option key={m} value={m}>
                    {m.replace('openrouter/', '').replace('anthropic/', '').replace('google/', '').replace('openai/', '')}
                  </option>
                ))}
              </select>
            )}
            {restartNote && (
              <p className="text-[10px] text-emerald-400">Model updated — takes effect on next message</p>
            )}
          </div>

          {/* Usage stats */}
          {usage.details && (
            <div className="border-t border-border pt-3 space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Usage Stats</div>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                <span>Messages used: <span className="text-foreground font-medium">{bat.totalUsed || 0}</span></span>
                <span>Today cost: <span className="text-foreground font-medium">${(usage.details.today?.cost || 0).toFixed(2)}</span></span>
              </div>
            </div>
          )}

          {/* BYOK */}
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Your API Key (optional)</div>
            <p className="text-[10px] text-muted-foreground">
              Add your own API key for <span className="text-emerald-400 font-medium">unlimited usage</span> — no battery drain, no limits.
              A free Google Gemini key works too!
            </p>
            <BYOKInput />
          </div>

          {/* Beta badge */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <span className="text-amber-400 text-sm">🎉</span>
              <div>
                <p className="text-[11px] text-amber-400 font-medium">Beta Access</p>
                <p className="text-[10px] text-muted-foreground">
                  You're one of the first users! All Pro features included at Starter price — for life.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
