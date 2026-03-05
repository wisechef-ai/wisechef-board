import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Loader2, Bot, User, Building2, CheckCircle2,
  ChevronRight, RotateCcw, Edit3, ChevronDown, Sparkles,
  ArrowRight, AlertCircle
} from 'lucide-react'

// ── Phase 1: Interview questions ──────────────────────────────────────────────
const QUESTIONS = [
  {
    key: 'intro',
    bot: "Hi! I'm the WiseChef setup assistant 👋\n\nI'll ask a few questions to configure your AI team. Takes about 3 minutes.\n\n**What's your company name and what do you do?**",
    placeholder: 'e.g. Inter-Plus — we provide fiber internet and TV across the Chełm region'
  },
  {
    key: 'region',
    bot: '**What region or city are you based in?**',
    placeholder: 'e.g. Warsaw, Poland'
  },
  {
    key: 'language',
    bot: '**What language should your AI agents speak with your team?**',
    placeholder: 'e.g. Polish, English, German…'
  },
  {
    key: 'departments',
    bot: "**Walk me through your main departments and what each team does day-to-day.**\n\nOne per line works great — include a brief description after a dash:",
    placeholder: 'Management — daily briefings, KPI tracking\nField Ops — technician scheduling, job dispatch\nCustomer Support — complaints, account queries\nMarketing — social media, promo content'
  },
  {
    key: 'owner',
    bot: "**Who's the owner or CEO I should report to?**",
    placeholder: 'e.g. Jan Kowalski, CEO'
  },
  {
    key: 'pain',
    bot: "**What's your biggest operational pain point right now?**",
    placeholder: 'e.g. We lose 2 hours/day coordinating field techs manually — no visibility on job status'
  }
]

const AGENT_ROLES = ['orchestrator','field-ops','customer-support','marketing','admin','sales','finance','hr']

const ROLE_NAMES = {
  'orchestrator':     ['MARCO','ARIA','APEX','CORE'],
  'field-ops':        ['DISPATCH','FIELD','OPS','TECH'],
  'customer-support': ['SUPPORT','CARA','HELP','RELAY'],
  'marketing':        ['NOVA','SPARK','BRAND','PULSE'],
  'admin':            ['ADMIN','VERA','BASE'],
  'sales':            ['SALES','ACE','BOOST'],
  'finance':          ['FINANCE','LEDGER','CFO'],
  'hr':               ['HR','PEOPLE','HIRE'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/ą/g,'a').replace(/ę/g,'e').replace(/ó/g,'o').replace(/ś/g,'s')
    .replace(/ł/g,'l').replace(/ż/g,'z').replace(/ź/g,'z').replace(/ć/g,'c').replace(/ń/g,'n')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'company'
}
function detectLanguage(r='') {
  const l = r.toLowerCase()
  if (/polish|polski|^pl/.test(l)) return 'pl'
  if (/german|deutsch|^de/.test(l)) return 'de'
  if (/french|français|^fr/.test(l)) return 'fr'
  return 'en'
}
function detectTimezone(r='') {
  if (/poland|polska|warszawa|krakow|chelm|wroclaw|gdansk|poznan|łódź|lodz/i.test(r)) return 'Europe/Warsaw'
  if (/germany|berlin|münchen|munich|frankfurt/i.test(r)) return 'Europe/Berlin'
  if (/uk|united kingdom|london|manchester/i.test(r)) return 'Europe/London'
  if (/france|paris|lyon/i.test(r)) return 'Europe/Paris'
  return 'Europe/Warsaw'
}
function inferRole(name, idx) {
  const n = (name||'').toLowerCase()
  if (idx===0 || /manag|director|ceo|chief|dyrekcja|zarząd|board|exec/i.test(n)) return 'orchestrator'
  if (/field|tech|install|ops|dispatch|dysp|montaż|serwis|service|technician/i.test(n)) return 'field-ops'
  if (/support|obsług|customer|client|helpdesk|biuro|contact/i.test(n)) return 'customer-support'
  if (/market|growth|social|reklam|promo|brand|digital/i.test(n)) return 'marketing'
  if (/sales|sprzedaż|handl|commercial|revenue/i.test(n)) return 'sales'
  if (/finance|finanse|billing|account|księgow|invoic/i.test(n)) return 'finance'
  if (/hr|human|people|kadry|recruitment/i.test(n)) return 'hr'
  return 'admin'
}
function nextAgentName(role, used) {
  const names = ROLE_NAMES[role] || ['AGENT']
  return names.find(n => !used.has(n)) || `${role.toUpperCase()}-${used.size}`
}
function parseDepartments(raw) {
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean)
  const used = new Set()
  return lines.map((line, i) => {
    const [namePart, ...descParts] = line.split(/\s*[—–:-]\s*/)
    const name = namePart.trim()
    const workflows = descParts.length
      ? descParts.join(' ').split(/,\s*/).map(s=>s.trim()).filter(Boolean)
      : [`Handle ${name} operations`]
    const role = inferRole(name, i)
    const agentName = nextAgentName(role, used)
    used.add(agentName)
    return { id: slugify(name), name, agentName, agentRole: role, workflows }
  })
}
function buildCompanyJson(answers, departments) {
  const [namePart] = (answers.intro||'').split(/\s*[—–-]\s*/)
  const name = namePart.trim() || answers.intro
  const [ownerName, ...ownerRoleParts] = (answers.owner||'').split(/,\s*/)
  return {
    schemaVersion: 1,
    slug:     slugify(name),
    name,
    description: answers.intro,
    industry: detectIndustry(answers.intro),
    region:   (answers.region||'').trim(),
    language: detectLanguage(answers.language),
    timezone: detectTimezone(answers.region),
    owner:    { name: ownerName.trim(), role: ownerRoleParts.join(', ').trim() || 'Owner' },
    contacts: [],
    departments: departments.map(d => ({
      ...d,
      telegramGroupName: `${name} — ${d.name}`
    })),
    integrations: [],
    plan: 'enterprise-5',
    painPoint: answers.pain,
    _source:    'enterprise-wizard',
    _createdAt: new Date().toISOString(),
  }
}
function detectIndustry(t='') {
  const i = t.toLowerCase()
  if (/telco|internet|telecom|fiber|broadband|tv|cable/i.test(i)) return 'telco'
  if (/logistics|delivery|transport|freight/i.test(i)) return 'logistics'
  if (/food|restaurant|catering|kitchen/i.test(i)) return 'food'
  if (/retail|shop|store|ecommerce/i.test(i)) return 'retail'
  if (/health|medical|clinic|hospital/i.test(i)) return 'healthcare'
  if (/education|school|training/i.test(i)) return 'education'
  if (/construction|building|budowlany/i.test(i)) return 'construction'
  if (/finance|fintech|bank|insurance/i.test(i)) return 'finance'
  if (/software|saas|tech|it /i.test(i)) return 'tech'
  return 'other'
}
function bold(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\n/g,'<br />')
}

// ── Phase-level constants ─────────────────────────────────────────────────────
const PHASE = { CHAT: 1, MAPPING: 2, PREVIEW: 3, DONE: 4 }

// ═════════════════════════════════════════════════════════════════════════════
export default function EnterpriseOnboarding() {
  const [phase, setPhase]           = useState(PHASE.CHAT)
  // Phase 1
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [qIdx, setQIdx]             = useState(0)
  const [answers, setAnswers]       = useState({})
  // Phase 2
  const [departments, setDepartments] = useState([])
  const [companyJson, setCompanyJson] = useState(null)
  const [editingJson, setEditingJson] = useState(false)
  const [jsonText, setJsonText]       = useState('')
  // Phase 3
  const [provisioning, setProvisioning] = useState(false)
  const [provisionResult, setProvisionResult] = useState(null)
  const [provisionError, setProvisionError]   = useState(null)

  const messagesEnd = useRef(null)
  const inputRef    = useRef(null)

  const scrollBottom = useCallback(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  useEffect(() => { scrollBottom() }, [messages, scrollBottom])

  // Kick off with first question
  useEffect(() => { pushBot(QUESTIONS[0].bot) }, [])

  function pushBot(text, delay=0) {
    setTimeout(() => setMessages(p => [...p, { role:'bot', text, ts:Date.now() }]), delay)
  }
  function pushUser(text) {
    setMessages(p => [...p, { role:'user', text, ts:Date.now() }])
  }

  // ── Phase 1: chat interview ───────────────────────────────────────────────
  async function handleSend(e) {
    e?.preventDefault()
    const val = input.trim()
    if (!val || sending) return

    setInput('')
    pushUser(val)
    setSending(true)

    const q          = QUESTIONS[qIdx]
    const newAnswers = { ...answers, [q.key]: val }
    setAnswers(newAnswers)
    const next = qIdx + 1

    if (next < QUESTIONS.length) {
      // Optional AI ack — fires async, degrades gracefully
      fetchAck(q.key, val).then(ack => {
        if (ack) pushBot(ack)
        pushBot(QUESTIONS[next].bot, ack ? 600 : 200)
        setSending(false)
        setTimeout(() => inputRef.current?.focus(), 400)
      }).catch(() => {
        pushBot(QUESTIONS[next].bot, 200)
        setSending(false)
      })
      setQIdx(next)
    } else {
      // All answers collected — synthesise
      setSending(true)
      pushBot("Analysing your answers and generating your company profile… ⏳", 300)
      try {
        const depts = parseDepartments(newAnswers.departments || '')
        const company = buildCompanyJson(newAnswers, depts)
        setDepartments(depts)
        setCompanyJson(company)
        setJsonText(JSON.stringify(company, null, 2))
        pushBot(
          `**Preview generated!** I've mapped ${depts.length} department${depts.length!==1?'s':''} to your AI team.\n\nScroll down to review and adjust the agent mapping ↓`,
          900
        )
        setTimeout(() => { setSending(false); setPhase(PHASE.MAPPING) }, 1200)
      } catch(err) {
        pushBot(`⚠️ Something went wrong: ${err.message}. Try again.`, 400)
        setSending(false)
      }
    }
  }

  async function fetchAck(key, answer) {
    const res = await fetch('/api/enterprise/interview-ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepKey: key, answer }),
      signal: AbortSignal.timeout(6000)
    })
    const d = await res.json()
    return d.ack || null
  }

  // ── Phase 2: department mapping ───────────────────────────────────────────
  function updateDept(idx, field, value) {
    setDepartments(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      // If role changes, suggest new agent name unless user customised it
      if (field === 'agentRole') {
        const used = new Set(next.map((d,i) => i!==idx ? d.agentName : null).filter(Boolean))
        next[idx].agentName = nextAgentName(value, used)
      }
      return next
    })
  }

  function confirmMapping() {
    const used = new Set()
    // Ensure no duplicate agent names
    const deduped = departments.map(d => {
      const name = used.has(d.agentName)
        ? nextAgentName(d.agentRole, used)
        : d.agentName
      used.add(name)
      return { ...d, agentName: name }
    })
    const updated = buildCompanyJson(answers, deduped)
    setDepartments(deduped)
    setCompanyJson(updated)
    setJsonText(JSON.stringify(updated, null, 2))
    setPhase(PHASE.PREVIEW)
  }

  // ── Phase 3: provision ────────────────────────────────────────────────────
  async function handleProvision() {
    setProvisioning(true)
    setProvisionError(null)
    try {
      const body = editingJson
        ? JSON.parse(jsonText)  // user may have hand-edited
        : companyJson
      const res  = await fetch('/api/enterprise/provision', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ company: body })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Provision failed')
      setProvisionResult(data)
      setPhase(PHASE.DONE)
    } catch(err) {
      setProvisionError(err.message)
    } finally {
      setProvisioning(false)
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  function restart() {
    setPhase(PHASE.CHAT)
    setMessages([])
    setInput('')
    setSending(false)
    setQIdx(0)
    setAnswers({})
    setDepartments([])
    setCompanyJson(null)
    setProvisionResult(null)
    setProvisionError(null)
    setTimeout(() => pushBot(QUESTIONS[0].bot), 100)
  }

  // ── Progress % ────────────────────────────────────────────────────────────
  const pct = phase === PHASE.CHAT
    ? Math.round((qIdx / QUESTIONS.length) * 50)
    : phase === PHASE.MAPPING ? 60
    : phase === PHASE.PREVIEW ? 80
    : 100

  const PHASE_LABELS = ['','Interview','Agent Mapping','Review & Provision','Done']

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-primary" />
          <h2 className="text-sm font-medium">Enterprise Onboarding</h2>
          <span className="text-xs text-muted-foreground">— {PHASE_LABELS[phase]}</span>
        </div>
        <button onClick={restart} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Start over">
          <RotateCcw size={14} />
        </button>
      </div>

      {/* ── Progress bar ── */}
      <div className="h-1 bg-muted shrink-0">
        <div className="h-full bg-gradient-to-r from-amber-400 to-red-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>

      {/* ── Phase tabs ── */}
      <div className="flex items-center gap-0 shrink-0 border-b border-border/50 px-4 py-1.5">
        {[PHASE.CHAT, PHASE.MAPPING, PHASE.PREVIEW, PHASE.DONE].map((p, i) => (
          <React.Fragment key={p}>
            <div className={`text-xs px-2 py-0.5 rounded ${
              phase === p ? 'text-primary font-medium' :
              phase > p   ? 'text-emerald-400' : 'text-muted-foreground'
            }`}>
              {phase > p && '✓ '}{PHASE_LABELS[p]}
            </div>
            {i < 3 && <ChevronRight size={10} className="text-muted-foreground/30" />}
          </React.Fragment>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE 1 — Chat interview                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === PHASE.CHAT && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role==='user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2.5 text-sm ${
                  m.role==='user'
                    ? 'bg-primary/15 text-foreground border border-primary/30'
                    : 'bg-card text-card-foreground border border-border'
                }`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {m.role==='user'
                      ? <><User size={11}/><span className="text-xs text-muted-foreground">You</span></>
                      : <><Bot size={11} className="text-primary"/><span className="text-xs text-muted-foreground">WiseChef</span></>
                    }
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: bold(m.text) }} />
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-card border border-border rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-primary"/>
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={messagesEnd}/>
          </div>

          <form onSubmit={handleSend} className="p-3 border-t border-border shrink-0">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={QUESTIONS[Math.min(qIdx, QUESTIONS.length-1)]?.placeholder || 'Type your answer…'}
                rows={Math.min(Math.max(input.split('\n').length, 1), 5)}
                className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
                disabled={sending}
                autoFocus
              />
              <button
                type="submit" disabled={!input.trim() || sending}
                className="bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-lg px-3 py-2 transition-colors self-end"
              >
                <Send size={16}/>
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 ml-1">
              <kbd className="bg-muted px-1 rounded text-[10px]">Enter</kbd> to send ·{' '}
              <kbd className="bg-muted px-1 rounded text-[10px]">Shift+Enter</kbd> for new line
            </p>
          </form>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE 2 — Department → Agent mapping                               */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === PHASE.MAPPING && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-1">Review agent assignments</h3>
            <p className="text-xs text-muted-foreground">Adjust agent names and roles before provisioning. The first department is always the orchestrator (MARCO).</p>
          </div>

          <div className="space-y-3 mb-6">
            {departments.map((dept, i) => (
              <div key={dept.id} className="bg-card border border-border rounded-lg p-3">
                <div className="flex items-start gap-3">
                  {/* Department name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">Department</p>
                    <p className="text-sm font-medium truncate">{dept.name}</p>
                    {dept.workflows?.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {dept.workflows.slice(0,2).join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="text-muted-foreground/40 mt-4"><ArrowRight size={14}/></div>

                  {/* Agent name (editable) */}
                  <div className="w-28">
                    <p className="text-xs text-muted-foreground mb-0.5">Agent name</p>
                    <input
                      value={dept.agentName}
                      onChange={e => updateDept(i, 'agentName', e.target.value.toUpperCase().slice(0,10))}
                      className="w-full bg-background border border-border rounded px-2 py-1 text-sm font-mono font-semibold text-primary focus:outline-none focus:border-primary uppercase"
                    />
                  </div>

                  {/* Role selector */}
                  <div className="w-40">
                    <p className="text-xs text-muted-foreground mb-0.5">Role</p>
                    <div className="relative">
                      <select
                        value={dept.agentRole}
                        onChange={e => updateDept(i, 'agentRole', e.target.value)}
                        className="w-full appearance-none bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary pr-6"
                      >
                        {AGENT_ROLES.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"/>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={confirmMapping}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
          >
            <Sparkles size={15}/>
            Confirm mapping — generate preview
            <ChevronRight size={15}/>
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE 3 — Provisioning preview                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === PHASE.PREVIEW && companyJson && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-1">Provisioning plan</h3>
            <p className="text-xs text-muted-foreground">
              These Telegram groups and agent workspaces will be created.
              Group creation (gramjs) is pending credentials — shown as <em>pending</em> below.
            </p>
          </div>

          {/* Groups list */}
          <div className="bg-card border border-border rounded-lg divide-y divide-border mb-4 overflow-hidden">
            <div className="px-3 py-2 bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Telegram Groups</p>
            </div>
            {companyJson.departments.map(d => (
              <div key={d.id} className="px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{d.telegramGroupName}</p>
                  <p className="text-xs text-muted-foreground">→ {d.agentName} ({d.agentRole})</p>
                </div>
                <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5">
                  pending
                </span>
              </div>
            ))}
          </div>

          {/* What WILL be done now */}
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 mb-4">
            <p className="text-xs font-medium text-emerald-400 mb-1.5">✅ What happens when you click Provision:</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• <code>company.json</code> saved to <code>~/clawd/wisechef/clients/{companyJson.slug}/</code></li>
              <li>• SOUL.md, MEMORY.md, HEARTBEAT.md written to server workspace</li>
              <li>• System prompts generated for each agent</li>
              <li>• Gateway restarted</li>
              <li>• Telegram group creation: <span className="text-amber-400">manual step (pending credentials)</span></li>
            </ul>
          </div>

          {/* company.json preview / edit */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-muted-foreground">company.json preview</p>
              <button
                onClick={() => setEditingJson(v => !v)}
                className="text-xs text-primary flex items-center gap-1 hover:underline"
              >
                <Edit3 size={11}/>{editingJson ? 'Done editing' : 'Edit'}
              </button>
            </div>
            {editingJson ? (
              <textarea
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                className="w-full h-48 bg-background border border-border rounded-lg p-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary resize-none"
              />
            ) : (
              <pre className="bg-background border border-border rounded-lg p-3 text-xs text-muted-foreground overflow-x-auto max-h-48">
                {jsonText}
              </pre>
            )}
          </div>

          {provisionError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
              <AlertCircle size={15} className="shrink-0 mt-0.5"/>
              <span>{provisionError}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setPhase(PHASE.MAPPING)}
              className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent text-muted-foreground"
            >
              ← Back
            </button>
            <button
              onClick={handleProvision}
              disabled={provisioning}
              className="flex-1 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
            >
              {provisioning
                ? <><Loader2 size={15} className="animate-spin"/>Provisioning…</>
                : <><Sparkles size={15}/>Provision workspace</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PHASE 4 — Done                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {phase === PHASE.DONE && (
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h3 className="text-lg font-bold mb-2">Workspace provisioned!</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            <strong>{companyJson?.name}</strong>'s AI team is configured.
            {' '}SOUL.md, MEMORY.md and system prompts are live on the server.
            Telegram group creation will complete once credentials are added.
          </p>

          {provisionResult && (
            <div className="bg-card border border-border rounded-lg p-4 text-left w-full max-w-sm mb-6 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Result</p>
              <p className="text-xs"><span className="text-muted-foreground">Slug:</span> <code className="text-primary">{provisionResult.slug}</code></p>
              <p className="text-xs"><span className="text-muted-foreground">Departments:</span> {provisionResult.departments}</p>
              <p className="text-xs"><span className="text-muted-foreground">Files written:</span> {provisionResult.filesWritten ?? '—'}</p>
              <p className="text-xs"><span className="text-muted-foreground">Groups:</span> <span className="text-amber-400">pending credentials</span></p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={restart}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent text-muted-foreground"
            >
              Onboard another company
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
