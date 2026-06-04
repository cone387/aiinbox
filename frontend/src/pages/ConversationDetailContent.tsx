import { useState } from 'react'
import { ConversationDetail as ConvDetail } from '../types'
import dayjs from 'dayjs'

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
}

export default function ConversationDetailContent({ conv, listCollapsed, onToggleList }: Props) {
  const [copied, setCopied] = useState(false)

  function copyMessage(content: string) {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function copyCodeBlock(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.classList.contains('code-copy-btn')) {
      const pre = target.closest('pre')
      const code = pre?.querySelector('code')
      if (code) {
        navigator.clipboard.writeText(code.textContent || '')
        target.textContent = '✓'
        setTimeout(() => { target.textContent = '复制' }, 1500)
      }
    }
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
        <div className="conv-header-left">
          <button className="sidebar-toggle-btn" onClick={onToggleList} title={listCollapsed ? '展开对话列表' : '折叠对话列表'}>
            <CollapseIcon size={18} />
          </button>
          <div className="conv-info">
            <div className="conv-title">{conv.title}</div>
            <div className="conv-meta">
              {conv.platform} · {conv.message_count} 条消息 · {dayjs(conv.created_at).format('YYYY-MM-DD HH:mm')}
            </div>
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
                <div className="markdown-body" onClick={copyCodeBlock} dangerouslySetInnerHTML={{ __html: simpleMarkdown(msg.content) }} />
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
        ))}
      </div>
    </div>
  )
}

// Simple markdown renderer
function simpleMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><button class="code-copy-btn">复制</button><code>$2</code></pre>')
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
  // Blockquotes (consecutive lines)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br/>')
  // Horizontal rule
  html = html.replace(/^-{3,}$/gm, '<hr/>')
  // Tables
  html = html.replace(/(?:^|\n)((?:\|.+\|\n?)+)/g, (_match, tableBlock: string) => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim())
    if (rows.length < 2) return tableBlock
    // Check if second row is separator
    const isSep = /^\|[\s\-:|]+\|$/.test(rows[1].trim())
    if (!isSep) return tableBlock
    const headerCells = rows[0].split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
    const thead = '<thead><tr>' + headerCells.map(c => `<th>${c}</th>`).join('') + '</tr></thead>'
    const bodyRows = rows.slice(2)
    const tbody = '<tbody>' + bodyRows.map(row => {
      const cells = row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim())
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>'
    }).join('') + '</tbody>'
    return `<table>${thead}${tbody}</table>`
  })
  // Unordered lists
  html = html.replace(/(?:^|\n)((?:- .+\n?)+)/g, (_match, listBlock: string) => {
    const items = listBlock.trim().split('\n').map(line => line.replace(/^- /, ''))
    return '<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>'
  })
  // Paragraphs: double newline = new paragraph, single newline = <br/>
  html = html.replace(/\n\n+/g, '</p><p>')
  html = html.replace(/\n/g, '<br/>')
  html = '<p>' + html + '</p>'
  // Clean up empty paragraphs and paragraphs wrapping block elements
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p>(<h[1-3]>)/g, '$1')
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<pre>)/g, '$1')
  html = html.replace(/(<\/pre>)<\/p>/g, '$1')
  html = html.replace(/<p>(<blockquote>)/g, '$1')
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1')
  html = html.replace(/<p>(<table>)/g, '$1')
  html = html.replace(/(<\/table>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>)/g, '$1')
  html = html.replace(/(<\/ul>)<\/p>/g, '$1')
  html = html.replace(/<p>(<hr\/>)/g, '$1')
  html = html.replace(/(<hr\/>)<\/p>/g, '$1')
  return html
}
