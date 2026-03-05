import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Bot, User, Building2, CheckCircle2, ChevronRight, RotateCcw } from 'lucide-react'

// ── Interview script ──────────────────────────────────────────────────────────
// Each step has a key, a bot opening message, and validation hint.
// The AI is used for free-form follow-up; the script drives the skeleton.
const STEPS = [
  {
    key: 'intro',
    bot: "Hi! I'm the WiseChef setup assistant 👋\n\nI'll ask you a few questions to build your company's AI team. This takes about 3–4 minutes.\n\nLet's start: **What's your company name and what do you do?**",
    placeholder: 'e.g. Inter-Plus — we provide internet and TV to households in the Chełm region'
  },
  {
    key: 'region',
    bot: 'Got it! **What region or city are you based in?**',
    placeholder: 'e.g. Warsaw, Poland'
  },
  {
    key: 'language',
    bot: 'Perfect. **What language should your AI agents speak with your team?**',
    placeholder: 'e.g. Polish, English, German…'
  },
  {
    key: 'departments',
    bot: "Now the most important part.\n\n**Walk me through your main departments and what each team does day-to-day.**\n\nList as many as you like — one per line works well:",
    placeholder: 'e.g.\nManagement — daily briefings, KPI tracking\nField Ops — job scheduling, technician dispatch\nCustomer Support — complaints, account queries\nMarketing — social media, promo materials'
  },
  {
    key: 'owner',
    bot: "Almost done! **What's your name and role?** And the best email or phone to reach you?",
    placeholder: 'e.g. Jan Kowalski, CEO — jan@company.com'
  },
  {
    key: 'extras',
    bot: "Last one: **Any integrations or special requirements?** (CRM, ticketing system, LMS, etc. — or just say 'none')",
    placeholder: 'e.g. LMS at lms.company.com — or none'
  }
]

// Progress % per step
const PROGRESS = [0, 18, 36, 54, 72, 90, 100]

export default function EnterpriseOnboarding() {
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [stepIdx, setStepIdx]       = useState(0)
  const [answers, setAnswers]       = useState({})
  const [done, setDone]             = useState(false)
  const [slug, setSlug]             = useState(null)
  const [error, setError]           = useState(null)
  const messagesEnd                  = useRef(null)
  const inputRef                     = useRef(null)

  const scrollBottom = useCallback(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollBottom() }, [messages, scrollBottom])

  // Kick off with first bot message
  useEffect(() => {
    pushBot(STEPS[0].bot)
    // eslint-disable-next-line
  }, [])

  function pushBot(text, delay = 0) {
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'bot', text, ts: Date.now() }])
    }, delay)
  }

  function pushUser(text) {
    setMessages(prev => [...prev, { role: 'user', text, ts: Date.now() }])
  }

  async function handleSend(e) {
    e?.preventDefault()
    const val = input.trim()
    if (!val || sending || done) return

    setInput('')
    pushUser(val)
    setSending(true)

    const currentStep = STEPS[stepIdx]
    const newAnswers  = { ...answers, [currentStep.key]: val }
    setAnswers(newAnswers)

    const nextIdx = stepIdx + 1

    if (nextIdx < STEPS.length) {
      // Move to next scripted question — optionally add AI acknowledgement
      try {
        const ack = await fetchAck(currentStep.key, val, newAnswers)
        if (ack) pushBot(ack, 300)
        pushBot(STEPS[nextIdx].bot, ack ? 900 : 300)
      } catch {
        pushBot(STEPS[nextIdx].bot, 300)
      }
      setStepIdx(nextIdx)
      setSending(false)
      setTimeout(() => inputRef.current?.focus(), 400)
    } else {
      // All answers collected — submit
      pushBot("Perfect — I have everything I need. Let me set up your workspace now… ⏳", 300)
      try {
        const res  = await fetch('/api/enterprise/onboard', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ answers: newAnswers })
        })
        const data = await res.json()
        if (res.ok && data.ok) {
          setSlug(data.slug)
          setDone(true)
          pushBot(
            `✅ **Your workspace is being set up!**\n\nI've created your AI team configuration for **${data.companyName}** with ${data.departments} departments.\n\nWe'll send you invite links for your Telegram groups within a few minutes. If you have any questions, reach out to support@wisechef.ai`,
            800
          )
        } else {
          throw new Error(data.error || 'Unknown error')
        }
      } catch (err) {
        setError(err.message)
        pushBot(`⚠️ Something went wrong: ${err.message}\n\nPlease email us at support@wisechef.ai and we'll set you up manually.`, 400)
      } finally {
        setSending(false)
      }
    }
  }

  // Optional AI acknowledgement between steps (fires and forgets, gracefully degrades)
  async function fetchAck(stepKey, answer, allAnswers) {
    try {
      const res = await fetch('/api/enterprise/interview-ack', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stepKey, answer, allAnswers }),
        signal:  AbortSignal.timeout(8000)
      })
      const data = await res.json()
      return data.ack || null
    } catch {
      return null // graceful degradation — interview continues without AI ack
    }
  }

  function restart() {
    setMessages([])
    setAnswers({})
    setStepIdx(0)
    setDone(false)
    setSlug(null)
    setError(null)
    setInput('')
    setTimeout(() => pushBot(STEPS[0].bot), 100)
  }

  const progress = PROGRESS[Math.min(stepIdx, STEPS.length)]

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-primary" />
          <h2 className="text-sm font-medium">Enterprise Onboarding</h2>
          {done && <CheckCircle2 size={14} className="text-emerald-400" />}
        </div>
        <button
          onClick={restart}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          title="Start over"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted shrink-0">
        <div
          className="h-full bg-gradient-to-r from-amber-400 to-red-500 transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1.5 px-4 py-2 shrink-0 border-b border-border/50">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={`w-2 h-2 rounded-full transition-colors ${
              i < stepIdx ? 'bg-emerald-400' :
              i === stepIdx ? 'bg-primary' :
              'bg-muted'
            }`} />
            {i < STEPS.length - 1 && <ChevronRight size={10} className="text-muted-foreground/40" />}
          </React.Fragment>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {done ? 'Complete!' : `Step ${stepIdx + 1} of ${STEPS.length}`}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2.5 text-sm ${
              m.role === 'user'
                ? 'bg-primary/15 text-foreground border border-primary/30'
                : 'bg-card text-card-foreground border border-border'
            }`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                {m.role === 'user'
                  ? <><User size={11} /><span className="text-xs text-muted-foreground">You</span></>
                  : <><Bot size={11} className="text-primary" /><span className="text-xs text-muted-foreground">WiseChef</span></>
                }
              </div>
              <div className="whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMessage(m.text) }} />
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-3 py-2.5 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      {!done ? (
        <form onSubmit={handleSend} className="p-3 border-t border-border shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              placeholder={STEPS[Math.min(stepIdx, STEPS.length - 1)]?.placeholder || 'Type your answer…'}
              rows={input.split('\n').length > 1 ? Math.min(input.split('\n').length + 1, 5) : 1}
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none transition-all"
              disabled={sending}
              autoFocus
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-lg px-3 py-2 transition-colors self-end"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 ml-1">
            Press <kbd className="bg-muted px-1 rounded text-[10px]">Enter</kbd> to send, <kbd className="bg-muted px-1 rounded text-[10px]">Shift+Enter</kbd> for new line
          </p>
        </form>
      ) : (
        <div className="p-4 border-t border-border shrink-0 flex items-center justify-between bg-emerald-500/5 border-emerald-500/20">
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle2 size={16} />
            <span>Setup submitted successfully</span>
            {slug && <span className="text-muted-foreground text-xs">· slug: {slug}</span>}
          </div>
          <button
            onClick={restart}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Start another
          </button>
        </div>
      )}
    </div>
  )
}

// Render **bold** markdown in bot messages safely
function formatMessage(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />')
}
