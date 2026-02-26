import React, { useState, useEffect } from 'react'
import { Key, Check, X, ChevronRight, Zap, Shield, Infinity, AlertTriangle, Trash2, LogIn } from 'lucide-react'

const PROVIDERS = [
  { id: 'github-copilot', name: 'GitHub Copilot', logo: '🐙', placeholder: '(uses device login)',
    subscription: { name: 'Copilot', desc: 'Log in with your GitHub account — works with any Copilot plan', flow: 'device' },
    note: '💡 Best value — Claude, GPT-5, Gemini 3 + more included', authType: 'device' },
  { id: 'anthropic', name: 'Anthropic', logo: '🟤', placeholder: 'sk-ant-api03-...',
    note: 'Get your API key at console.anthropic.com', authType: 'apikey' },
  { id: 'openai', name: 'OpenAI', logo: '🟢', placeholder: 'sk-proj-...',
    note: 'Get your API key at platform.openai.com', authType: 'apikey' },
  { id: 'google', name: 'Google AI', logo: '🔵', placeholder: 'AIza...',
    note: '💡 Free API keys at aistudio.google.com — no credit card needed', authType: 'apikey' },
  { id: 'openrouter', name: 'OpenRouter', logo: '🟣', placeholder: 'sk-or-v1-...',
    note: '💡 One key, all models. Pay-as-you-go. openrouter.ai', authType: 'apikey' },
]

function ProviderCard({ provider, connected, masked, onConnect, onRemove, onSubscriptionLogin }) {
  const [expanded, setExpanded] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [deviceFlow, setDeviceFlow] = useState(null) // { flowId, userCode, verificationUrl }
  const [deviceStatus, setDeviceStatus] = useState(null) // 'waiting' | 'complete' | 'expired' | 'denied'
  const [loginResult, setLoginResult] = useState(null)

  const save = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    setError(null)
    const res = await onConnect(provider.id, apiKey.trim())
    if (res.success) {
      setApiKey('')
      setExpanded(false)
    } else {
      setError(res.error || 'Failed to save')
    }
    setSaving(false)
  }

  const startDevice = async () => {
    setDeviceStatus('starting')
    try {
      const res = await fetch('/api/providers/device/start', { method: 'POST' })
      const data = await res.json()
      if (data.userCode) {
        setDeviceFlow(data)
        setDeviceStatus('waiting')
        pollDevice(data.flowId)
      } else {
        setDeviceStatus(null)
        setError(data.error || 'Failed to start login')
      }
    } catch { setDeviceStatus(null); setError('Network error') }
  }

  const pollDevice = async (flowId) => {
    for (let i = 0; i < 60; i++) { // poll for ~5 min
      await new Promise(r => setTimeout(r, 5000))
      try {
        const res = await fetch('/api/providers/device/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flowId }),
        })
        const data = await res.json()
        if (data.status === 'complete') {
          setDeviceStatus('complete')
          setDeviceFlow(null)
          onSubscriptionLogin?.()
          return
        }
        if (data.status === 'expired' || data.status === 'denied') {
          setDeviceStatus(data.status)
          setDeviceFlow(null)
          return
        }
        // pending — keep polling
      } catch { break }
    }
  }

  const loginSubscription = async () => {
    if (provider.subscription?.flow === 'device') {
      startDevice()
    } else if (provider.subscription?.steps) {
      setLoginResult({ ok: false, instructions: provider.subscription.steps })
    }
  }

  return (
    <div className={`border rounded-lg p-4 transition-all ${connected ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border hover:border-primary/30'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{provider.logo}</span>
          <div>
            <h3 className="font-medium text-sm">{provider.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {connected ? <span className="text-emerald-400">Connected {masked}</span> : `${provider.models.length} models available`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <button onClick={() => onRemove(provider.id)} className="text-red-400 hover:text-red-300 p-1" title="Remove key">
              <Trash2 size={14} />
            </button>
          )}
          {!connected && (
            <button onClick={() => setExpanded(!expanded)}
              className="bg-primary/10 hover:bg-primary/20 text-primary rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1">
              Connect <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          )}
          {connected && <Check size={16} className="text-emerald-400" />}
        </div>
      </div>
      {expanded && !connected && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* Subscription login option */}
          {provider.subscription && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <LogIn size={14} className="text-blue-400" />
                <span className="text-xs font-medium">Have a {provider.subscription.name} subscription?</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{provider.subscription.desc}</p>
              
              {/* Device flow UI (GitHub Copilot) */}
              {deviceFlow && deviceStatus === 'waiting' && (
                <div className="bg-secondary rounded-lg p-4 space-y-3 text-center">
                  <p className="text-xs text-muted-foreground">Enter this code at GitHub:</p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-2xl font-mono font-bold tracking-widest text-foreground select-all cursor-text" onClick={e => {
                      navigator.clipboard.writeText(deviceFlow.userCode)
                      e.target.style.color = '#10b981'
                      setTimeout(() => e.target.style.color = '', 1000)
                    }}>
                      {deviceFlow.userCode}
                    </code>
                    <button onClick={() => navigator.clipboard.writeText(deviceFlow.userCode)}
                      className="text-muted-foreground hover:text-foreground p-1" title="Copy code">
                      📋
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Click the code to copy</p>
                  <a href={deviceFlow.verificationUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-block bg-blue-600 hover:bg-blue-500 text-white rounded-md px-4 py-2 text-xs font-medium">
                    Open GitHub →
                  </a>
                  <p className="text-[10px] text-muted-foreground animate-pulse">Waiting for authorization...</p>
                </div>
              )}
              {deviceStatus === 'complete' && (
                <p className="text-[11px] text-emerald-400 font-medium">✅ GitHub Copilot connected!</p>
              )}
              {deviceStatus === 'expired' && (
                <p className="text-[11px] text-red-400">Code expired. <button onClick={startDevice} className="underline">Try again</button></p>
              )}
              {deviceStatus === 'denied' && (
                <p className="text-[11px] text-red-400">Login cancelled. <button onClick={startDevice} className="underline">Try again</button></p>
              )}
              
              {!deviceFlow && deviceStatus !== 'complete' && (
                <button onClick={loginSubscription} disabled={deviceStatus === 'starting'}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md px-4 py-1.5 text-xs font-medium">
                  {deviceStatus === 'starting' ? 'Starting...' : provider.subscription.flow === 'device' ? 'Start Login' : `Use ${provider.subscription.name}`}
                </button>
              )}
              
              {loginResult && loginResult.instructions ? (
                <div className="bg-secondary/50 rounded p-2 space-y-1">
                  {loginResult.instructions.map((step, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">{step}</p>
                  ))}
                </div>
              ) : loginResult && (
                <p className={`text-[11px] ${loginResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{loginResult.msg}</p>
              )}
              {!deviceFlow && deviceStatus !== 'complete' && (
                <div className="text-[10px] text-muted-foreground">— or use an API key below —</div>
              )}
            </div>
          )}

          {provider.note && (
            <p className="text-[11px] text-blue-400">{provider.note}</p>
          )}

          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={provider.placeholder}
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !apiKey.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md px-4 py-1.5 text-xs font-medium">
              {saving ? 'Saving...' : 'Save & Connect'}
            </button>
            <button onClick={() => { setExpanded(false); setApiKey(''); setError(null) }}
              className="text-muted-foreground hover:text-foreground text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AIProviderPage() {
  const [providers, setProviders] = useState({})
  const [models, setModels] = useState([])
  const [currentModel, setCurrentModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [limits, setLimits] = useState(null)

  const isBYOK = Object.values(providers).some(p => p.hasKey)

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(setProviders).catch(() => {})
    fetch('/api/models').then(r => r.json()).then(setModels).catch(() => {})
    fetch('/api/usage').then(r => r.json()).then(d => setCurrentModel(d.model || '')).catch(() => {})
    fetch('/api/usage-limits').then(r => r.json()).then(setLimits).catch(() => {})
  }, [])

  const connectProvider = async (providerId, apiKey) => {
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      })
      const data = await res.json()
      if (data.success) {
        setProviders(p => ({ ...p, [providerId]: { hasKey: true, masked: data.masked } }))
        // Refresh limits (should now show byok=true)
        fetch('/api/usage-limits').then(r => r.json()).then(setLimits).catch(() => {})
      }
      return data
    } catch (e) { return { error: e.message } }
  }

  const removeProvider = async (providerId) => {
    await fetch(`/api/providers/${providerId}`, { method: 'DELETE' })
    setProviders(p => { const n = { ...p }; delete n[providerId]; return n })
    fetch('/api/usage-limits').then(r => r.json()).then(setLimits).catch(() => {})
  }

  const applyModel = async (model) => {
    if (!model) return
    setApplying(true)
    setApplied(false)
    try {
      await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      // Restart gateway for immediate effect
      await fetch('/api/gateway/restart', { method: 'POST' })
      setCurrentModel(model)
      setApplied(true)
      setTimeout(() => setApplied(false), 5000)
    } catch {}
    setApplying(false)
  }

  // Fetch available models from backend
  const [availableModels, setAvailableModels] = useState([])
  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(models => {
      if (Array.isArray(models)) setAvailableModels(models)
    }).catch(() => {})
  }, [currentModel]) // re-fetch after model change

  // Build model list: available models grouped by provider prefix
  const allModels = availableModels.map(m => {
    const provider = m.split('/')[0] || 'unknown'
    const providerName = PROVIDERS.find(p => p.id === provider)?.name || provider
    return { label: m.replace(/^[^/]+\//, ''), value: m, provider: providerName }
  })

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2"><Zap size={20} className="text-orange-400" /> AI Provider</h2>
        <p className="text-sm text-muted-foreground mt-1">Connect your own AI subscription for unlimited usage — or use WiseChef credits.</p>
      </div>

      {/* Benefits banner */}
      {!isBYOK && (
        <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 rounded-lg p-4 space-y-2">
          <h3 className="font-medium text-sm flex items-center gap-2"><Infinity size={16} className="text-emerald-400" /> Why connect your own key?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-start gap-2"><Check size={12} className="text-emerald-400 mt-0.5 shrink-0" /><span><b className="text-foreground">Unlimited usage</b> — no monthly caps or downgrades</span></div>
            <div className="flex items-start gap-2"><Check size={12} className="text-emerald-400 mt-0.5 shrink-0" /><span><b className="text-foreground">Choose any model</b> — use the latest and most powerful</span></div>
            <div className="flex items-start gap-2"><Check size={12} className="text-emerald-400 mt-0.5 shrink-0" /><span><b className="text-foreground">Your key, your data</b> — direct connection to the provider</span></div>
          </div>
        </div>
      )}

      {/* Current status */}
      {limits && !isBYOK && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Using WiseChef credits — <b className="text-foreground">{limits.percent}%</b> of your monthly allowance used.
            {limits.percent >= 50 && ' Connect your own key to remove limits.'}
          </p>
        </div>
      )}

      {isBYOK && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-3">
          <Shield size={16} className="text-emerald-400 shrink-0" />
          <p className="text-xs text-foreground">
            <b>Unlimited mode</b> — you're using your own API key. No usage caps apply.
          </p>
        </div>
      )}

      {/* Provider cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Providers</h3>
        {PROVIDERS.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            connected={!!providers[p.id]?.hasKey}
            masked={providers[p.id]?.masked}
            onConnect={connectProvider}
            onRemove={removeProvider}
            onSubscriptionLogin={() => {
              fetch('/api/providers').then(r => r.json()).then(setProviders).catch(() => {})
              fetch('/api/usage-limits').then(r => r.json()).then(setLimits).catch(() => {})
            }}
          />
        ))}
      </div>

      {/* Model selector */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Active Model</h3>
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Current:</span>
            <span className="font-medium text-foreground">{currentModel.replace(/^(anthropic|openai|google|openrouter)\//, '')}</span>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Select model</label>
            <select
              value={currentModel}
              onChange={e => setCurrentModel(e.target.value)}
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              {allModels.map(m => (
                <option key={m.value} value={m.value}>{m.label} ({m.provider})</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Or enter a custom model name</label>
            <div className="flex gap-2">
              <input
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder="e.g. anthropic/claude-sonnet-4-6"
                className="flex-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <button
            onClick={() => applyModel(customModel.trim() || currentModel)}
            disabled={applying}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            {applying ? 'Applying...' : applied ? '✅ Applied — new conversations will use this model' : 'Apply & Restart'}
          </button>
        </div>
      </div>
    </div>
  )
}
