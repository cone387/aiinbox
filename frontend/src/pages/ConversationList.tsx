import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Select, DatePicker, Empty, Spin, Tag, Pagination } from 'antd'
import { listConversations, ListParams } from '../api/conversations'
import { Conversation, PaginatedResponse } from '../types'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

const platformOptions = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'tongyi', label: '通义千问' },
  { value: 'doubao', label: '豆包' },
]

const platformColors: Record<string, string> = {
  chatgpt: 'green',
  gemini: 'blue',
  tongyi: 'purple',
  doubao: 'orange',
}

export default function ConversationList() {
  const navigate = useNavigate()
  const [data, setData] = useState<PaginatedResponse<Conversation> | null>(null)
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useState<ListParams>({ page: 1, page_size: 20 })

  useEffect(() => {
    fetchData()
  }, [params])

  async function fetchData() {
    setLoading(true)
    try {
      const result = await listConversations(params)
      setData(result)
    } catch {
      // Error handled by interceptor
    }
    setLoading(false)
  }

  return (
    <div>
      {/* Filters */}
      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Select
            mode="multiple"
            placeholder="选择平台"
            options={platformOptions}
            style={{ minWidth: 200 }}
            onChange={(values) => setParams((p) => ({ ...p, platform: values, page: 1 }))}
            allowClear
          />
          <RangePicker
            onChange={(dates) => {
              if (dates) {
                setParams((p) => ({
                  ...p,
                  start_time: dates[0]?.toISOString(),
                  end_time: dates[1]?.toISOString(),
                  page: 1,
                }))
              } else {
                setParams((p) => ({ ...p, start_time: undefined, end_time: undefined, page: 1 }))
              }
            }}
          />
          {data && (
            <span style={{ lineHeight: '32px', color: '#666' }}>
              共 {data.total} 条对话
            </span>
          )}
        </div>
      </Card>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px' }}><Spin size="large" /></div>
      ) : !data?.items.length ? (
        <Empty description="暂无对话记录" />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.items.map((conv) => (
              <Card
                key={conv.id}
                hoverable
                size="small"
                onClick={() => navigate(`/conversations/${conv.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Tag color={platformColors[conv.platform]}>{conv.platform}</Tag>
                    <span style={{ fontWeight: 500 }}>{conv.title || 'Untitled'}</span>
                  </div>
                  <div style={{ color: '#999', fontSize: '12px' }}>
                    <span>{conv.message_count} 条消息</span>
                    <span style={{ marginLeft: '12px' }}>{dayjs(conv.created_at).format('MM-DD HH:mm')}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <Pagination
              current={data.page}
              pageSize={data.page_size}
              total={data.total}
              onChange={(page) => setParams((p) => ({ ...p, page }))}
              showSizeChanger={false}
            />
          </div>
        </>
      )}
    </div>
  )
}
