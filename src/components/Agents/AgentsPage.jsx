import React, { useState, useEffect, useCallback } from 'react'
import { Bot, Cpu, Brain, Zap, RefreshCw, Settings2, ChevronDown, Check, Loader2, Circle, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import PageSkeleton from '../PageSkeleton'

const MODELS = [
  // GitHub Copilot (OAuth — already authenticated)
  { value: 'github-copilot/claude-opus-4.6', label: 'Claude Opus 4.6', provider: 'GitHub Copilot', cost: '$$$' },
  { value: 'github-copilot/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gpt-5.2', label: 'GPT-5.2', provider: 'GitHub Copilot', cost: '$$$' },
  { value: 'github-copilot/gpt-5.2-codex', label: 'GPT-5.2 Codex', provider: 'GitHub Copilot', cost: '$$$' },
  { value: 'github-copilot/gpt-5-mini', label: 'GPT-5 Mini', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gpt-4o', label: 'GPT-4o', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gemini-3-pro-preview', label: 'Gemini 3 Pro', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'GitHub Copilot', cost: '$' },
  // OpenAI Codex (OAuth)
  { value: 'openai-codex/gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'OpenAI Codex', cost: '$$$' },
  { value: 'openai-codex/gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', provider: 'OpenAI Codex', cost: '$$' },
  { value: 'openai-codex/gpt-5.2', label: 'GPT-5.2', provider: 'OpenAI Codex', cost: '$$$' },
  // OpenAI Direct (API key)
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', cost: '$' },
  { value: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', cost: '$$' },
]

const THINKING_LEVELS = [
  { value: 'off', label: 'Off', desc: 'No reasoning traces' },
  { value: 'low', label: 'Low', desc: 'Quick reasoning' },
  { value: 'medium', label: 'Medium', desc: 'Balanced' },
  { value: 'high', label: 'High', desc: 'Deep reasoning' },
]

const ROLE_COLORS = {
  'Chief Executive Officer': 'from-amber-500 to-orange-500',
  'CEO': 'from-amber-500 to-orange-500',
  'Lead Engineer': 'from-blue-500 to-cyan-500',
  'Growth Lead': 'from-green-500 to-emerald-500',
  'DevOps Engineer': 'from-purple-500 to-violet-500',
  'DevOps': 'from-purple-500 to-violet-500',
  'Admin / Orchestrator': 'from-red-500 to-pink-500',
  'Personal Assistant': 'from-red-500 to-pink-500',
}

const ROLE_ICONS = {
  'Chief Executive Officer': '🍳',
  'CEO': '🍳',
  'Lead Engineer': '⚙️',
  'Growth Lead': '📈',
  'DevOps Engineer': '🔧',
  'DevOps': '🔧',
  'Admin / Orchestrator': '🦉',
  'Personal Assistant': '🦉',
}

function ModelSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const current = MODELS.find(m => m.value === value) || MODELS[0]

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm border transition-colors',
          'border-border bg-background hover:border-primary/50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cpu size={14} className="text-muted-foreground shrink-0" />
          <span className="truncate">{current.label}</span>
          <span className="text-xs text-muted-foreground shrink-0">{current.provider}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-amber-400">{current.cost}</span>
          <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
        </div>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg py-1 max-h-60 overflow-auto">
          {MODELS.map(m => (
            <button
              key={m.value}
              onClick={() => { onChange(m.value); setOpen(false) }}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 text-sm transition-colors',
                m.value === value ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
              )}
            >
              <div className="flex items-center gap-2">
                {m.value === value && <Check size={14} />}
                <span className={m.value !== value ? 'ml-[22px]' : ''}>{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.provider}</span>
              </div>
              <span className="text-xs text-amber-400">{m.cost}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent, gatewayStatus, onSave }) {
  const [model, setModel] = useState(agent.model || 'gpt-4o-mini')
  const [thinking, setThinking] = useState(agent.thinking || 'off')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isDirty = model !== (agent.model || 'gpt-4o-mini') || thinking !== (agent.thinking || 'off')
  const isOnline = gatewayStatus?.[agent.id]?.online === true
  const isLegacy = agent.status === 'legacy'

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(agent.id, { model, thinking })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const color = ROLE_COLORS[agent.role] || 'from-gray-500 to-gray-600'
  const icon = ROLE_ICONS[agent.role] || '🤖'

  return (
    <div className={cn(
      'rounded-lg border bg-card overflow-hidden transition-all',
      isOnline ? 'border-border' : 'border-border/50 opacity-75',
      isLegacy && 'opacity-50'
    )}>
      {/* Color bar */}
      <div className={cn('h-1 bg-gradient-to-r', color)} />
      
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{icon}</div>
            <div>
              <h3 className="font-medium text-sm">{agent.name}</h3>
              <p className="text-xs text-muted-foreground">{agent.role}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isOnline ? (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                <Circle size={6} className="fill-green-400" /> Online
              </span>
            ) : isLegacy ? (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-500/10 text-gray-400 border border-gray-500/20">
                Legacy
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-400 border border-red-500/20">
                <Circle size={6} className="fill-red-400" /> Offline
              </span>
            )}
          </div>
        </div>

        {/* Home channel */}
        {agent.home_channel && (
          <div className="text-xs text-muted-foreground">
            📍 #{agent.home_channel}
          </div>
        )}

        {/* Model + Thinking config (not for legacy) */}
        {!isLegacy && (
          <>
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Cpu size={12} /> LLM Model
              </label>
              <ModelSelect value={model} onChange={setModel} disabled={isLegacy} />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Brain size={12} /> Thinking Level
              </label>
              <div className="flex gap-1.5">
                {THINKING_LEVELS.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setThinking(t.value)}
                    disabled={isLegacy}
                    title={t.desc}
                    className={cn(
                      'flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors',
                      thinking === t.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Save button */}
            {isDirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={12} /> : saved ? <Check size={12} /> : <Settings2 size={12} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Apply'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState([])
  const [gatewayStatus, setGatewayStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchAgents = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const [agentsRes, statusRes] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/agents/status'),
      ])
      const agentsData = await agentsRes.json()
      const statusData = await statusRes.json()
      setAgents(agentsData.agents || [])
      setGatewayStatus(statusData.bots || {})
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchAgents()
    const interval = setInterval(() => fetchAgents(), 30000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  const handleSave = async (agentId, config) => {
    const r = await fetch(`/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!r.ok) throw new Error('Save failed')
    await fetchAgents()
  }

  if (loading) return <PageSkeleton variant="settings" />

  const active = agents.filter(a => a.status !== 'legacy')
  const legacy = agents.filter(a => a.status === 'legacy')
  const onlineCount = Object.values(gatewayStatus).filter(b => b.online).length

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot size={20} className="text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Agent Team</h2>
            <p className="text-xs text-muted-foreground">
              {onlineCount}/{active.length} agents online • Manage models and thinking levels
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchAgents(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Gateway Status */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onlineCount > 0 ? (
              <Wifi size={16} className="text-green-400" />
            ) : (
              <WifiOff size={16} className="text-red-400" />
            )}
            <span className="text-sm font-medium">Bot Gateway</span>
          </div>
          <span className={cn(
            'px-2 py-0.5 rounded-full text-xs font-medium border',
            onlineCount > 0
              ? 'bg-green-500/10 text-green-400 border-green-500/20'
              : 'bg-red-500/10 text-red-400 border-red-500/20'
          )}>
            {onlineCount > 0 ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Active Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {active.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            gatewayStatus={gatewayStatus}
            onSave={handleSave}
          />
        ))}
      </div>

      {/* Legacy Agents */}
      {legacy.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Legacy Bots</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {legacy.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                gatewayStatus={gatewayStatus}
                onSave={handleSave}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
