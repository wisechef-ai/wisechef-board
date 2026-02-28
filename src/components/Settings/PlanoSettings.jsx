import React, { useState, useEffect } from 'react'
import { Loader2, Play, Square, RefreshCw, Save, Check, AlertCircle, ExternalLink, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function PlanoSettings() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState('')
  const [savedConfig, setSavedConfig] = useState('')
  const [configLoading, setConfigLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchStatus = async () => {
    try {
      const r = await fetch('/api/plano/status')
      setStatus(await r.json())
    } catch { setStatus(null) }
    setLoading(false)
  }

  const fetchConfig = async () => {
    try {
      const r = await fetch('/api/plano/config')
      const d = await r.json()
      setConfig(d.config)
      setSavedConfig(d.config)
    } catch {}
    setConfigLoading(false)
  }

  useEffect(() => { fetchStatus(); fetchConfig() }, [])

  const handleAction = async (action) => {
    setActionLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/plano/${action}`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `${action} failed`)
      await fetchStatus()
    } catch (e) {
      setError(e.message)
    }
    setActionLoading(false)
  }

  const handleSaveConfig = async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch('/api/plano/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setSavedConfig(config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const configDirty = config !== savedConfig

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
      <Loader2 className="animate-spin" size={14} /> Loading Plano status…
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Status & Controls */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-400" />
            <h3 className="font-medium text-sm">Plano Model Router</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              'px-2 py-0.5 rounded-full text-xs font-medium border',
              status?.running
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-muted text-muted-foreground border-border'
            )}>
              {status?.running ? `Running on :${status.port}` : 'Stopped'}
            </span>
            {!status?.installed && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Not installed
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Plano routes cheap queries (greetings, simple lookups) to fast models like Kimi K2.5,
          and complex queries (analysis, code, strategy) to Claude Opus. Estimated savings: ~50%.
        </p>

        <div className="flex items-center gap-2">
          {status?.running ? (
            <button
              onClick={() => handleAction('stop')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="animate-spin" size={14} /> : <Square size={14} />}
              Stop
            </button>
          ) : (
            <button
              onClick={() => handleAction('start')}
              disabled={actionLoading || !status?.enabled}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
              Start
            </button>
          )}
          <button
            onClick={fetchStatus}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {!status?.enabled && (
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-md p-3">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>Plano is disabled. Set <code className="bg-muted px-1 rounded text-foreground">PLANO_ENABLED=true</code> in your .env file to enable it.</span>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Setup Guide */}
      {!status?.installed && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h3 className="font-medium text-sm">Setup Guide</h3>
          <div className="text-xs text-muted-foreground space-y-2">
            <p><strong>1. Install Plano:</strong></p>
            <code className="block bg-muted text-foreground px-3 py-2 rounded-md">pip install plano-router</code>
            <p><strong>2. Add to your .env:</strong></p>
            <code className="block bg-muted text-foreground px-3 py-2 rounded-md whitespace-pre">{`PLANO_ENABLED=true\nPLANO_PORT=12000`}</code>
            <p><strong>3. Point OpenClaw at Plano:</strong></p>
            <code className="block bg-muted text-foreground px-3 py-2 rounded-md whitespace-pre">{`# In openclaw.json or env:\nOPENAI_BASE_URL=http://localhost:12000/v1`}</code>
            <p><strong>4. Start from this page or run:</strong></p>
            <code className="block bg-muted text-foreground px-3 py-2 rounded-md">plano --config ~/.plano/config.yaml --port 12000</code>
            <a
              href="https://github.com/katanemo/plano"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Plano documentation <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      {/* Estimated Savings */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="font-medium text-sm">Estimated Savings</h3>
        <p className="text-xs text-muted-foreground">
          Based on typical usage patterns, Plano can reduce LLM costs by routing simple queries to cheaper models.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-border p-3 text-center">
            <div className="text-lg font-bold text-green-400">~50%</div>
            <div className="text-xs text-muted-foreground">Cost reduction</div>
          </div>
          <div className="rounded-md border border-border p-3 text-center">
            <div className="text-lg font-bold text-blue-400">~70%</div>
            <div className="text-xs text-muted-foreground">Queries routed cheap</div>
          </div>
          <div className="rounded-md border border-border p-3 text-center">
            <div className="text-lg font-bold text-violet-400">~30%</div>
            <div className="text-xs text-muted-foreground">Use premium model</div>
          </div>
        </div>
      </div>

      {/* Config Editor */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Routing Config (YAML)</h3>
          {status?.configPath && (
            <span className="text-xs text-muted-foreground font-mono">{status.configPath}</span>
          )}
        </div>
        {configLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="animate-spin" size={14} /> Loading config…
          </div>
        ) : (
          <>
            <textarea
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              className="w-full h-80 px-3 py-2 rounded-md text-xs font-mono border border-border bg-background text-foreground resize-y focus:outline-none focus:border-primary/50"
              spellCheck="false"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveConfig}
                disabled={!configDirty || saving}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  configDirty
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : saved ? <Check size={14} /> : <Save size={14} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save Config'}
              </button>
              {saved && <span className="text-xs text-green-400">Restart Plano to apply changes.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
