import { useState } from 'react'
import { ConversationDetail as ConvDetail } from '../types'
import dayjs from 'dayjs'

interface Props {
  conv: ConvDetail
}

export default function ConversationDetailContent({ conv }: Props) {
  const [copied, setCopied] = useState(false)

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
      md += `${msg.content}\n\n---\n\n`
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
        <div className="conv-info">
          <div className="conv-title">{conv.title}</div>
          <div className="conv-meta">
            {conv.platform} · {conv.message_count} 条消息 · {dayjs(conv.created_at).format('YYYY-MM-DD HH:mm')}
          </div>
        </div>
        <button className="export-btn" onClick={exportMarkdown} title="导出 Markdown">
          ↓ 导出
        </button>
      </div>

      <div className="messages-container">
        {conv.messages.map((msg) => (
          <div key={msg.id} className={`message-row ${msg.role}`}>
            <div className={`message-bubble ${msg.role}`}>
              <div className="message-content">
                {msg.role === 'user' ? (
                  <p className="user-text">{msg.content}</p>
                ) : (
                  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: simpleMarkdown(msg.content) }} />
                )}
              </div>
              <div className="message-footer">
                <span className="timestamp">{dayjs(msg.timestamp).format('HH:mm:ss')}</span>
                <button className="copy-btn" onClick={() => copyMessage(msg.content)} title="复制">
                  {copied ? '✓' : '📋'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Simple markdown renderer
function simpleMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
  // Line breaks
  html = html.replace(/\n/g, '<br/>')
  return html
}
