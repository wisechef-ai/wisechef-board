import React, { useState, useEffect } from 'react'
import { Key, Check, X, ChevronRight, Zap, Shield, Infinity, AlertTriangle, Trash2, LogIn } from 'lucide-react'

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', logo: '🟤', placeholder: 'sk-ant-api03-...', models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'],
    subscription: { name: 'Claude Pro/Max', desc: 'Use your Claude Pro or Max subscription — no API key needed',
      steps: ['Run "claude setup-token" in any terminal', 'Copy the token it gives you', 'Paste it as your API key above'] } },
  { id: 'openai', name: 'OpenAI', logo: '🟢', placeholder: 'sk-proj-...', models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini'],
    subscription: { name: 'ChatGPT Plus/Pro', desc: 'Use your ChatGPT subscription — get an API key from platform.openai.com',
      steps: ['Go to platform.openai.com → sign in', 'API Keys → Create new key', 'Copy key (starts with sk-) and paste above'] } },
  { id: 'github-copilot', name: 'GitHub Copilot', logo: '🐙', placeholder: '(uses device login — no key needed)', models: ['gpt-4.1', 'gpt-4o', 'claude-sonnet-4-6', 'claude-opus-4-6'],
    subscription: { name: 'Copilot ($10/mo)', desc: 'Use your GitHub Copilot plan — device-flow login, no API key needed',
      steps: ['You need a GitHub account with Copilot enabled ($10/mo)', 'In terminal: openclaw models auth login-github-copilot', 'Approve the device code on github.com', 'Done — models available immediately'] },
    note: '💡 Best value: $10/mo gets you GPT-4.1 + Claude Sonnet + more' },
  { id: 'google', name: 'Google AI', logo: '🔵', placeholder: 'AIza...', models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    note: '💡 Free API keys at aistudio.google.com — no credit card needed' },
  { id: 'openrouter', name: 'OpenRouter', logo: '🟣', placeholder: 'sk-or-v1-...', models: ['anthropic/claude-sonnet-4-6', 'openai/gpt-4.1', 'google/gemini-2.5-pro', 'meta-llama/llama-4-maverick'],
    note: '💡 One key, all models. Pay-as-you-go. openrouter.ai' },
  { id: 'venice', name: 'Venice AI', logo: '🏴', placeholder: 'vnc_...', models: ['llama-3.3-70b'],
    note: '🔒 Privacy-first inference — no data retention. venice.ai' },
  { id: 'ollama', name: 'Ollama (Local)', logo: '🦙', placeholder: 'http://localhost:11434', models: ['llama3', 'mistral', 'phi3'],
    note: '💻 Run models locally — completely free and private' },
]

function ProviderCard({ provider, connected, masked, onConnect, onRemove, onSubscriptionLogin }) {
  const [expanded, setExpanded] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [loggingIn, setLoggingIn] = useState(false)
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

  const loginSubscription = async () => {
    // Show inline steps from provider definition — no API call needed
    setLoginResult({ ok: false, instructions: provider.subscription.steps })
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
              <button onClick={loginSubscription} disabled={loggingIn}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md px-4 py-1.5 text-xs font-medium">
                {loggingIn ? 'Connecting...' : `Use ${provider.subscription.name}`}
              </button>
              {loginResult && loginResult.instructions ? (
                <div className="bg-secondary/50 rounded p-2 space-y-1">
                  {loginResult.instructions.map((step, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">{step}</p>
                  ))}
                </div>
              ) : loginResult && (
                <p className={`text-[11px] ${loginResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{loginResult.msg}</p>
              )}
              <div className="text-[10px] text-muted-foreground">— or use an API key below —</div>
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

  // Build model list based on connected providers
  const allModels = []
  PROVIDERS.forEach(p => {
    if (providers[p.id]?.hasKey || p.id === 'anthropic') {
      p.models.forEach(m => {
        const fullName = m.includes('/') ? m : `${p.id}/${m}`
        allModels.push({ label: m, value: fullName, provider: p.name })
      })
    }
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
            Using WiseChef credits — <b className="text-foreground">{limits.percent}%</b> of ${limits.cap} monthly cap used.
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
