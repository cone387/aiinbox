import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Spin, message } from 'antd'
import { ArrowLeftOutlined, CopyOutlined, DownloadOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import { getConversation } from '../api/conversations'
import { ConversationDetail as ConvDetail } from '../types'
import dayjs from 'dayjs'
import './ConversationDetail.css'

export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [conv, setConv] = useState<ConvDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) fetchData(parseInt(id))
  }, [id])

  async function fetchData(convId: number) {
    setLoading(true)
    try {
      const data = await getConversation(convId)
      setConv(data)
    } catch {
      message.error('加载对话失败')
    }
    setLoading(false)
  }

  function copyMessage(content: string) {
    navigator.clipboard.writeText(content)
    message.success('已复制')
  }

  function exportMarkdown() {
    if (!conv) return
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

  if (loading) return <div style={{ textAlign: 'center', padding: '48px' }}><Spin size="large" /></div>
  if (!conv) return null

  return (
    <div className="conversation-detail">
      {/* Header */}
      <div className="conv-header">
        <div className="conv-header-left">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} className="back-btn">
            返回
          </Button>
          <div className="conv-info">
            <div className="conv-title">{conv.title}</div>
            <div className="conv-meta">
              {conv.platform} · {conv.message_count} 条消息 · {dayjs(conv.created_at).format('YYYY-MM-DD HH:mm')}
            </div>
          </div>
        </div>
        <Button icon={<DownloadOutlined />} onClick={exportMarkdown}>导出</Button>
      </div>

      {/* Messages */}
      <div className="messages-container">
        {conv.messages.map((msg) => (
          <div key={msg.id} className={`message-row ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="avatar assistant-avatar">
                <RobotOutlined />
              </div>
            )}
            <div className={`message-bubble ${msg.role}`}>
              <div className="message-content markdown-body">
                {msg.role === 'user' ? (
                  <p className="user-text">{msg.content}</p>
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}
              </div>
              <div className="message-footer">
                <span className="timestamp">{dayjs(msg.timestamp).format('HH:mm:ss')}</span>
                <button className="copy-btn" onClick={() => copyMessage(msg.content)} title="复制">
                  <CopyOutlined />
                </button>
              </div>
            </div>
            {msg.role === 'user' && (
              <div className="avatar user-avatar">
                <UserOutlined />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
