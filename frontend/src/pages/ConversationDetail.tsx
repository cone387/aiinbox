import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Spin, Tag, message } from 'antd'
import { ArrowLeftOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import { getConversation } from '../api/conversations'
import { ConversationDetail as ConvDetail } from '../types'
import dayjs from 'dayjs'

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
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} style={{ marginRight: '12px' }}>
            返回
          </Button>
          <Tag color="blue">{conv.platform}</Tag>
          <span style={{ fontWeight: 600, fontSize: '16px' }}>{conv.title}</span>
        </div>
        <Button icon={<DownloadOutlined />} onClick={exportMarkdown}>导出 Markdown</Button>
      </div>

      <div style={{ color: '#666', fontSize: '12px', marginBottom: '16px' }}>
        {conv.message_count} 条消息 · {dayjs(conv.created_at).format('YYYY-MM-DD HH:mm')}
      </div>

      {/* Messages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {conv.messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: msg.role === 'user' ? '#1677ff' : '#f5f5f5',
                color: msg.role === 'user' ? 'white' : '#333',
                position: 'relative',
              }}
            >
              {!msg.is_complete && (
                <Tag color="warning" style={{ position: 'absolute', top: '-8px', right: '-8px', fontSize: '10px' }}>
                  不完整
                </Tag>
              )}
              <div className="markdown-body" style={{ fontSize: '14px', lineHeight: 1.6 }}>
                {msg.role === 'user' ? (
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <span style={{ fontSize: '11px', opacity: 0.6 }}>
                  {dayjs(msg.timestamp).format('HH:mm:ss')}
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyMessage(msg.content)}
                  style={{ color: msg.role === 'user' ? 'rgba(255,255,255,0.7)' : '#999' }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
