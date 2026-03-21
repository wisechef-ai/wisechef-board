import React, { useState, useEffect, useCallback } from 'react'
import { Bot, Cpu, Brain, Zap, RefreshCw, Settings2, ChevronDown, Check, Loader2, Circle, Wifi, WifiOff, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import PageSkeleton from '../PageSkeleton'

const MODELS = [
  { value: 'github-copilot/claude-opus-4.6', label: 'Claude Opus 4.6', provider: 'GitHub Copilot', cost: '$$$' },
  { value: 'github-copilot/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gpt-5.2', label: 'GPT-5.2', provider: 'GitHub Copilot', cost: '$$$' },
  { value: 'github-copilot/gpt-5-mini', label: 'GPT-5 Mini', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gpt-4o', label: 'GPT-4o', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gemini-3-pro-preview', label: 'Gemini 3 Pro', provider: 'GitHub Copilot', cost: '$$' },
  { value: 'github-copilot/gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'GitHub Copilot', cost: '$' },
  { value: 'openrouter/anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', provider: 'OpenRouter', cost: '$$' },
  { value: 'openrouter/minimax/minimax-m2.7', label: 'MiniMax M2.7', provider: 'OpenRouter', cost: '$' },
  { value: 'openrouter/google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'OpenRouter', cost: '$' },
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
  'Ruthless Mentor': 'from-orange-600 to-red-600',
  'Strategic Advisor': 'from-indigo-500 to-blue-500',
  'Agent': 'from-gray-500 to-gray-600',
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
  'Ruthless Mentor': '🔥',
  'Strategic Advisor': '🎯',
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

function AddAgentModal({ isOpen, onClose, onAdd, roles }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [roleId, setRoleId] = useState('')
  const [focus, setFocus] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  const handleRoleSelect = (r) => {
    setRoleId(r.id)
    setRole(r.name)
    if (!name) setName(r.name)
    setFocus(r.shortDescription || '')
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setAdding(true)
    setError(null)
    try {
      await onAdd({ name: name.trim(), role, roleId, priorityFocus: focus })
      setName('')
      setRole('')
      setRoleId('')
      setFocus('')
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to add agent')
    } finally {
      setAdding(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Plus size={18} className="text-primary" />
            Add Team Member
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Role templates */}
          {roles.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Role Template</label>
              <div className="grid grid-cols-1 gap-2">
                {roles.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleRoleSelect(r)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors',
                      roleId === r.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    <span className="text-xl">{r.emoji || '🤖'}</span>
                    <div>
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.shortDescription}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Growth Lead, Data Analyst..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {/* Role (if not from template) */}
          {!roleId && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <input
                type="text"
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="e.g. Marketing Lead, Research Analyst..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}

          {/* Focus */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Priority Focus</label>
            <input
              type="text"
              value={focus}
              onChange={e => setFocus(e.target.value)}
              placeholder="What should this agent focus on?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2.5 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={adding || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {adding ? 'Creating...' : 'Add Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent, gatewayStatus, onSave, onDelete }) {
  const [model, setModel] = useState(agent.model || 'gpt-4o-mini')
  const [thinking, setThinking] = useState(agent.thinking || 'off')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isDirty = model !== (agent.model || 'gpt-4o-mini') || thinking !== (agent.thinking || 'off')
  const isOnline = gatewayStatus?.[agent.id]?.online === true
  const isMain = agent.id === 'main'

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

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete(agent.id)
    } catch (e) {
      console.error(e)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const color = ROLE_COLORS[agent.role] || 'from-gray-500 to-gray-600'
  const icon = ROLE_ICONS[agent.role] || '🤖'

  return (
    <div className={cn(
      'rounded-lg border bg-card overflow-hidden transition-all',
      isOnline ? 'border-border' : 'border-border/50 opacity-75',
    )}>
      <div className={cn('h-1 bg-gradient-to-r', color)} />
      
      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{icon}</div>
            <div>
              <h3 className="font-medium text-sm">{agent.name}</h3>
              <p className="text-xs text-muted-foreground">{agent.role}</p>
              {agent.priorityFocus && (
                <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{agent.priorityFocus}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isOnline ? (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                <Circle size={6} className="fill-green-400" /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-400 border border-red-500/20">
                <Circle size={6} className="fill-red-400" /> Offline
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Cpu size={12} /> LLM Model
          </label>
          <ModelSelect value={model} onChange={setModel} />
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

        <div className="flex items-center justify-between">
          {isDirty ? (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={12} /> : saved ? <Check size={12} /> : <Settings2 size={12} />}
              {saving ? 'Saving…' : saved ? 'Saved' : 'Apply'}
            </button>
          ) : <div />}

          {!isMain && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-400">Delete?</span>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-2 py-1 rounded text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
                  {deleting ? '...' : 'Yes'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 rounded text-xs text-muted-foreground border border-border hover:bg-accent">
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                title="Remove agent"
              >
                <Trash2 size={14} />
              </button>
            )
          )}
        </div>
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
  const [showAdd, setShowAdd] = useState(false)
  const [roles, setRoles] = useState([])
  const [tierInfo, setTierInfo] = useState({ tier: 'starter', limits: { agents: 1 } })

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

  const fetchRoles = useCallback(async () => {
    try {
      const [rolesRes, tierRes] = await Promise.all([
        fetch('/api/onboarding/roles'),
        fetch('/api/onboarding/tier'),
      ])
      const rolesData = await rolesRes.json()
      const tierData = await tierRes.json()
      setRoles(rolesData.roles || [])
      setTierInfo(tierData)
    } catch {}
  }, [])

  useEffect(() => {
    fetchAgents()
    fetchRoles()
    const interval = setInterval(() => fetchAgents(), 30000)
    return () => clearInterval(interval)
  }, [fetchAgents, fetchRoles])

  const handleSave = async (agentId, config) => {
    const r = await fetch(`/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!r.ok) throw new Error('Save failed')
    await fetchAgents()
  }

  const handleAdd = async (agentData) => {
    const r = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentData),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Failed to create agent')
    await fetchAgents()
  }

  const handleDelete = async (agentId) => {
    const r = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
    if (!r.ok) {
      const data = await r.json()
      throw new Error(data.error || 'Failed to delete agent')
    }
    await fetchAgents()
  }

  if (loading) return <PageSkeleton variant="settings" />

  const onlineCount = Object.values(gatewayStatus).filter(b => b.online).length
  const canAdd = agents.length < (tierInfo.limits?.agents || 1)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot size={20} className="text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Agent Team</h2>
            <p className="text-xs text-muted-foreground">
              {onlineCount}/{agents.length} online • {agents.length}/{tierInfo.limits?.agents || '?'} agents ({tierInfo.tier} plan)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              Add Agent
            </button>
          )}
          <button
            onClick={() => fetchAgents(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            gatewayStatus={gatewayStatus}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {!canAdd && agents.length > 0 && (
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">
            Agent limit reached ({agents.length}/{tierInfo.limits?.agents}). Upgrade your plan to add more.
          </p>
        </div>
      )}

      <AddAgentModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={handleAdd}
        roles={roles}
      />
    </div>
  )
}
