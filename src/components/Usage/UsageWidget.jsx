import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ChevronDown, Cpu, Key, Trash2 } from 'lucide-react'

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

// 5 battery levels with proper colors
// Full (>80%) = green, High (60-80%) = green, Medium (30-60%) = yellow, Low (10-30%) = red, Critical (<5 credits) = blinking red
function getBatteryLevel(credits, maxCredits, byok) {
  if (byok) return { level: 'full', color: 'emerald', label: '∞', barClass: 'bg-emerald-500' }
  const pct = maxCredits > 0 ? (credits / maxCredits) * 100 : 0
  if (credits < 5) return { level: 'critical', color: 'red', label: '!', barClass: 'bg-red-500 animate-pulse' }
  if (pct <= 20) return { level: 'low', color: 'red', label: '▪', barClass: 'bg-red-500' }
  if (pct <= 50) return { level: 'medium', color: 'amber', label: '▪▪', barClass: 'bg-amber-500' }
  if (pct <= 80) return { level: 'high', color: 'emerald', label: '▪▪▪', barClass: 'bg-emerald-500' }
  return { level: 'full', color: 'emerald', label: '▪▪▪▪', barClass: 'bg-emerald-500' }
}

function BatteryIcon({ credits, maxCredits, byok }) {
  const { level, color } = getBatteryLevel(credits, maxCredits, byok)
  const colorClass = color === 'emerald' ? 'text-emerald-400' : color === 'amber' ? 'text-amber-400' : 'text-red-400'
  const blinkClass = level === 'critical' ? 'animate-pulse' : ''

  // SVG battery icon with fill level
  const pct = byok ? 100 : (maxCredits > 0 ? Math.max(5, (credits / maxCredits) * 100) : 0)
  const fillColor = color === 'emerald' ? '#34d399' : color === 'amber' ? '#fbbf24' : '#f87171'

  return (
    <svg width="20" height="12" viewBox="0 0 20 12" className={`${blinkClass} shrink-0`}>
      <rect x="0.5" y="0.5" width="16" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1" className="text-muted-foreground" />
      <rect x="17" y="3" width="2.5" height="6" rx="1" fill="currentColor" className="text-muted-foreground" />
      <rect x="2" y="2" width={Math.max(0, (pct / 100) * 13)} height="8" rx="1" fill={fillColor} />
    </svg>
  )
}

function BatteryBar({ credits, maxCredits, byok, hoursToFull, rechargePerHour }) {
  const { level, barClass } = getBatteryLevel(credits, maxCredits, byok)
  const pct = byok ? 100 : (maxCredits > 0 ? Math.round((credits / maxCredits) * 100) : 0)

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <BatteryIcon credits={credits} maxCredits={maxCredits} byok={byok} />
          <span className="text-sm font-medium text-foreground">
            {byok ? '∞ Unlimited' : `${credits} / ${maxCredits}`}
          </span>
          {!byok && (
            <span className="text-[10px] text-muted-foreground">credits</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {byok ? 'BYOK active' :
           hoursToFull === 0 ? '⚡ Full' :
           `+${rechargePerHour}/hr`}
        </span>
      </div>

      <div className="h-3 bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barClass}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>

      {level === 'critical' && (
        <p className="text-[10px] text-red-400 animate-pulse">
          🔋 Battery critically low! Recharging +{rechargePerHour}/hour. Add your own API key for unlimited usage.
        </p>
      )}
      {level === 'low' && (
        <p className="text-[10px] text-red-400">
          ⚡ Battery low — recharging. Add your own API key below for unlimited usage.
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
      // /api/usage-limits is the authoritative battery/byok source (usageGuard.js).
      // /api/usage is fetched in parallel for model + usage details only.
      const [limitsRes, legacyRes] = await Promise.all([
        fetch('/api/usage-limits'),
        fetch('/api/usage').catch(() => null),
      ])
      const limits = await limitsRes.json()
      const legacy = legacyRes ? await legacyRes.json().catch(() => ({})) : {}
      setUsage({
        ...legacy,
        battery: limits.battery,
        byok: limits.byok,
        limited: limits.limited,
        plan: limits.plan,
      })
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsage()
    fetch('/api/models').then(r => r.json()).then(setModels).catch(() => {})
    const iv = setInterval(fetchUsage, 60 * 1000)
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
  // /api/usage-limits returns credits:-1 for BYOK; fall back to maxCredits for display
  const maxCredits = (byok ? 50 : bat.maxCredits) || 50
  const credits = byok ? -1 : (bat.credits ?? maxCredits)
  const { level, color } = getBatteryLevel(credits, maxCredits, byok)

  const displayModel = (usage.model || 'unknown')
    .replace('openrouter/', '')
    .replace('anthropic/', '')
    .replace('google/', '')
    .replace('openai/', '')

  // Pill color matches battery level
  const pillColorClass = byok ? 'text-emerald-400' :
    color === 'emerald' ? 'text-emerald-400' :
    color === 'amber' ? 'text-amber-400' : 'text-red-400'
  const pillBlinkClass = level === 'critical' ? 'animate-pulse' : ''

  // Compact bar color
  const compactBarClass = byok ? 'bg-emerald-500' :
    color === 'emerald' ? 'bg-emerald-500' :
    color === 'amber' ? 'bg-amber-500' : 'bg-red-500'
  const compactBarBlink = level === 'critical' ? 'animate-pulse' : ''
  const pct = byok ? 100 : (maxCredits > 0 ? Math.round((credits / maxCredits) * 100) : 0)

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 sm:gap-2 bg-secondary/50 hover:bg-secondary/70 rounded-full px-2.5 sm:px-4 py-1.5 text-xs transition-colors"
      >
        <BatteryIcon credits={credits} maxCredits={maxCredits} byok={byok} />
        <span className="hidden sm:inline text-muted-foreground text-[10px]">{displayModel}</span>
        <div className="hidden sm:block w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${compactBarClass} ${compactBarBlink}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span className={`text-[10px] font-medium ${pillColorClass} ${pillBlinkClass}`}>
          {byok ? '∞' : `${credits}`}
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
            credits={credits}
            maxCredits={maxCredits}
            byok={byok}
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
                  You're one of the first users! All Pro features at Starter price — for life.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
