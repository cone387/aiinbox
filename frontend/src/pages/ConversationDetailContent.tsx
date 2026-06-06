import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ConversationDetail as ConvDetail } from '../types'
import dayjs from 'dayjs'
import 'highlight.js/styles/github.css'

const CollapseIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 1024 1024" width={size} height={size} fill="currentColor">
    <path d="M862.037333 171.093333A85.333333 85.333333 0 0 1 938.666667 256v512a85.333333 85.333333 0 0 1-76.629334 84.906667L853.333333 853.333333H170.666667a85.333333 85.333333 0 0 1-85.333334-85.333333V256a85.333333 85.333333 0 0 1 85.333334-85.333333h682.666666l8.704 0.426666zM170.666667 230.4a25.6 25.6 0 0 0-25.6 25.6v512a25.6 25.6 0 0 0 25.6 25.6h183.466666V230.4H170.666667z m243.2 563.2H853.333333a25.6 25.6 0 0 0 25.6-25.6V256a25.6 25.6 0 0 0-25.6-25.6H413.866667v563.2z" />
  </svg>
)

const CopyIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 1024 1024" width={size} height={size} fill="currentColor">
    <path d="M639.9 256.3H192.4c-35.2 0-63.9 28.8-63.9 63.9v575.4c0 35.2 28.8 63.9 63.9 63.9h447.5c35.2 0 63.9-28.8 63.9-63.9V320.2c0-35.1-28.8-63.9-63.9-63.9z m0 639.3H192.4V320.2h447.5v575.4z" />
    <path d="M831.6 64.5H384.1c-35.2 0-63.9 28.8-63.9 63.9v63.9h63.9v-63.9h447.5v575.4h-63.9v63.9h63.9c35.2 0 63.9-28.8 63.9-63.9V128.4c0.1-35.1-28.7-63.9-63.9-63.9z" />
  </svg>
)

interface Props {
  conv: ConvDetail
  listCollapsed: boolean
  onToggleList: () => void
  wasUnread?: boolean
}

// ChatGPT embeds link/citation tokens delimited by private-use chars:
// U+E200 start, U+E202 field separator, U+E201 end.
// A url token is  U+E200 "url" U+E202 {title} U+E202 {dest} U+E201.
// These render invisibly here, so the fields concatenate into garbage like
// "urlwx-clihttps://...". Convert url tokens to markdown links, drop the rest.
function cleanChatGPTTokens(text: string): string {
  const start = String.fromCharCode(0xe200)
  const end = String.fromCharCode(0xe201)
  const sep = String.fromCharCode(0xe202)
  const tokenRe = new RegExp(start + '(.*?)' + end, 'gs')
  return text
    .replace(tokenRe, (_m, inner: string) => {
      const parts = inner.split(sep)
      const type = parts[0]
      if ((type === 'url' || type === 'navlist') && parts.length >= 3) {
        const title = parts[1]
        const dest = parts[2]
        if (/^https?:\/\//.test(dest)) return `[${title}](${dest})`
        return title // search-result reference: keep title text, no link
      }
      if (type === 'url' && parts.length === 2) return parts[1]
      return '' // cite / video / other chips -> drop
    })
    .replace(/[-]/g, '') // strip any stray delimiters
}

function CodePre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    const code = e.currentTarget.closest('pre')?.querySelector('code')
    if (code) {
      navigator.clipboard.writeText(code.textContent || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <pre {...props}>
      <button className="code-copy-btn" onClick={handleCopy}>{copied ? '✓' : '复制'}</button>
      {children}
    </pre>
  )
}

export default function ConversationDetailContent({ conv, listCollapsed, onToggleList, wasUnread }: Props) {
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const firstUnreadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (wasUnread && firstUnreadRef.current) {
        firstUnreadRef.current.scrollIntoView({ block: 'start' })
      } else if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: 'end' })
      }
    })
  }, [conv.id])

  function copyMessage(content: string) {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function exportMarkdown() {
    let md = `# ${conv.title}\n\n`
    md += `平台: ${conv.platform} | 时间: ${dayjs(conv.created_at).format('YYYY-MM-DD HH:mm')}\n\n---\n\n`
    for (const msg of conv.messages) {
      md += `**${msg.role === 'user' ? '用户' : 'AI'}** (${dayjs(msg.timestamp).format('HH:mm:ss')})\n\n`
      md += `${cleanChatGPTTokens(msg.content)}\n\n---\n\n`
    }
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv.title || 'conversation'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="conversation-detail">
      <div className="conv-header">
        <div className="conv-header-left">
          <button className="sidebar-toggle-btn" onClick={onToggleList} title={listCollapsed ? '展开对话列表' : '折叠对话列表'}>
            <CollapseIcon size={18} />
          </button>
          <div className="conv-info">
            <div className="conv-title">{conv.title}</div>
            <div className="conv-meta">
              {conv.platform} · <span className="conv-platform-id" title="平台会话 ID（用于排查问题）" onClick={() => copyMessage(conv.conversation_id)}>{conv.conversation_id}</span> · {conv.message_count} 条消息 · {dayjs(conv.created_at).format('YYYY-MM-DD HH:mm')}
            </div>
          </div>
        </div>
        <button className="export-btn" onClick={exportMarkdown} title="导出 Markdown">
          ↓ 导出
        </button>
      </div>

      <div className="messages-container">
        {conv.messages.map((msg, idx) => {
        const isFirstUnread = wasUnread && conv.last_read_at
          ? idx === conv.messages.findIndex(m => m.timestamp > conv.last_read_at!)
          : false
        return (
        <div key={msg.id} className={`message-row ${msg.role}`} ref={isFirstUnread ? firstUnreadRef : undefined}>
          <div className={`message-bubble ${msg.role}`}>
            <div className="message-content">
              {msg.role === 'user' ? (
                <p className="user-text">{msg.content}</p>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={{ pre: CodePre }}
                  >
                    {cleanChatGPTTokens(msg.content)}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            <div className="message-footer">
              <span className="timestamp">{dayjs(msg.timestamp).format('HH:mm:ss')}</span>
              <button className="copy-btn" onClick={() => copyMessage(msg.content)} title="复制">
                {copied ? '✓' : <CopyIcon size={14} />}
              </button>
            </div>
          </div>
        </div>
        )})}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
