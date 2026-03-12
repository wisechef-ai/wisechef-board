import React, { useState, useEffect, lazy, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'

// Lazy-load the heavy syntax highlighter — only fetched when a file preview is opened
const SyntaxHighlighter = lazy(() =>
  import('react-syntax-highlighter').then(m => ({ default: m.Prism }))
)
const oneDarkPromise = import('react-syntax-highlighter/dist/esm/styles/prism').then(m => m.oneDark)

// Cache the style after first load
let oneDarkStyle = null
oneDarkPromise.then(s => { oneDarkStyle = s })

const extToLang = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', sh: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml',
  css: 'css', html: 'html', md: 'markdown',
}

function SyntaxFallback() {
  return <div className="p-4 text-sm text-muted-foreground animate-pulse">Loading highlighter…</div>
}

export default function FilePreview({ path }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [style, setStyle] = useState(oneDarkStyle)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/files/content?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(d => { setContent(d.content); setLoading(false) })
      .catch(() => { setContent('Failed to load file'); setLoading(false) })
  }, [path])

  // Load style if not yet cached
  useEffect(() => {
    if (!oneDarkStyle) {
      oneDarkPromise.then(s => setStyle(s))
    }
  }, [])

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>

  const ext = path.split('.').pop().toLowerCase()
  const isMarkdown = ext === 'md'

  if (isMarkdown) {
    return (
      <div className="p-4 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          components={{
            code({ node, inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <Suspense fallback={<SyntaxFallback />}>
                  <SyntaxHighlighter style={style || {}} language={match[1]} PreTag="div" {...props}>
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </Suspense>
              ) : (
                <code className={className} {...props}>{children}</code>
              )
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  const lang = extToLang[ext]
  if (lang) {
    return (
      <Suspense fallback={<SyntaxFallback />}>
        <SyntaxHighlighter style={style || {}} language={lang} customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8rem' }}>
          {content}
        </SyntaxHighlighter>
      </Suspense>
    )
  }

  return <pre className="p-4 text-sm whitespace-pre-wrap font-mono">{content}</pre>
}
