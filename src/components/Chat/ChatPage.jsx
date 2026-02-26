import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, Bot, User, RefreshCw } from 'lucide-react'

export default function ChatPage() {
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('wisechef-chat-messages') || '[]') } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [wsStatus, setWsStatus] = useState('connecting')
  const messagesEnd = useRef(null)
  const wsRef = useRef(null)
  const sessionRef = useRef(null)

  // Persist messages to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('wisechef-chat-messages', JSON.stringify(messages))
  }, [messages])

  const scrollToBottom = useCallback(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  // Connect to OpenClaw gateway via board proxy
  useEffect(() => {
    initSession()
    return () => { if (wsRef.current) wsRef.current.close() }
  }, [])

  async function initSession() {
    try {
      setWsStatus('connecting')
      const res = await fetch('/api/chat/session', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to create session')
      sessionRef.current = data.sessionKey
      setWsStatus('connected')
      // Load history
      if (data.history?.length) {
        setMessages(data.history.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || Date.now()
        })))
      }
    } catch (e) {
      console.error('Session init failed:', e)
      setWsStatus('error')
    }
  }

  async function sendMessage(e) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }])
    setSending(true)

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionKey: sessionRef.current })
      })
      const data = await res.json()
      if (data.ok && data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, timestamp: Date.now() }])
      } else {
        // Gateway might be restarting — wait and retry once
        setMessages(prev => [...prev, { role: 'system', content: '⏳ Agent is starting up — retrying in 10 seconds...', timestamp: Date.now() }])
        await new Promise(r => setTimeout(r, 10000))
        const retry = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionKey: sessionRef.current })
        })
        const retryData = await retry.json()
        // Remove the "starting up" system message
        setMessages(prev => prev.filter(m => !m.content?.includes('Agent is starting up')))
        if (retryData.ok && retryData.reply) {
          setMessages(prev => [...prev, { role: 'assistant', content: retryData.reply, timestamp: Date.now() }])
        } else {
          setMessages(prev => [...prev, { role: 'system', content: '⚠️ Agent is still warming up. Please try again in a moment.', timestamp: Date.now() }])
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'system', content: '⚠️ Failed to send. Try again.', timestamp: Date.now() }])
    } finally {
      setSending(false)
    }
  }

  function clearChat() {
    setMessages([])
    sessionStorage.removeItem('wisechef-chat-messages')
    sessionRef.current = null
    initSession()
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-emerald-400" />
          <h2 className="text-sm font-medium">Chat with WiseChef</h2>
          <span className={`inline-block w-2 h-2 rounded-full ${
            wsStatus === 'connected' ? 'bg-emerald-400' : 
            wsStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
          }`} />
        </div>
        <button onClick={clearChat} className="p-1.5 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300" title="New conversation">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-neutral-500 mt-12">
            <Bot size={40} className="mx-auto mb-3 text-neutral-600" />
            <p className="text-sm">Send a message to start chatting with your AI assistant.</p>
            <p className="text-xs mt-2 text-neutral-600">💡 Your assistant remembers previous conversations — no need to repeat context.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.role === 'user' 
                ? 'bg-emerald-600/20 text-emerald-100 border border-emerald-800/50' 
                : m.role === 'system'
                ? 'bg-yellow-600/10 text-yellow-200 border border-yellow-800/30'
                : 'bg-neutral-800 text-neutral-200 border border-neutral-700'
            }`}>
              <div className="flex items-center gap-1.5 mb-1">
                {m.role === 'user' ? <User size={12} /> : <Bot size={12} className="text-emerald-400" />}
                <span className="text-xs text-neutral-500">
                  {m.role === 'user' ? 'You' : 'WiseChef'}
                </span>
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-neutral-800 rounded-lg px-3 py-2 border border-neutral-700">
              <Loader2 size={14} className="animate-spin text-emerald-400" />
            </div>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-3 border-t border-neutral-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-600"
            disabled={sending}
            autoFocus
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white rounded-lg px-3 py-2 transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  )
}
