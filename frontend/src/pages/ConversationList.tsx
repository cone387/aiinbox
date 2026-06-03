import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, DatePicker, Empty, Spin, Tag, Pagination } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
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

const sortOptions = [
  { value: 'synced_at', label: '同步时间' },
  { value: 'created_at', label: '对话时间' },
  { value: 'updated_at', label: '更新时间' },
]

export default function ConversationList() {
  const navigate = useNavigate()
  const [data, setData] = useState<PaginatedResponse<Conversation> | null>(null)
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useState<ListParams>({
    page: 1,
    page_size: 20,
    sort_by: 'synced_at',
    order: 'desc',
  })

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

  function togglePlatform(platform: string) {
    setParams((p) => {
      const current = p.platform || []
      const next = current.includes(platform)
        ? current.filter((x) => x !== platform)
        : [...current, platform]
      return { ...p, platform: next.length > 0 ? next : undefined, page: 1 }
    })
  }

  function clearFilters() {
    setParams((p) => ({
      ...p,
      platform: undefined,
      start_time: undefined,
      end_time: undefined,
      page: 1,
    }))
  }

  const hasFilters = (params.platform && params.platform.length > 0) || params.start_time || params.end_time

  return (
    <div>
      {/* Filters & Sort */}
      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Platform filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ color: '#666', fontSize: '13px' }}>平台:</span>
            {platformOptions.map((opt) => {
              const selected = params.platform?.includes(opt.value)
              return (
                <span
                  key={opt.value}
                  style={{
                    cursor: 'pointer',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '13px',
                    background: selected ? platformColors[opt.value] : 'transparent',
                    color: selected ? '#fff' : '#666',
                  }}
                  onClick={() => togglePlatform(opt.value)}
                >
                  {opt.label}
                </span>
              )
            })}
            {hasFilters && (
              <span
                style={{ cursor: 'pointer', color: '#1677ff', fontSize: '12px', marginLeft: '4px' }}
                onClick={clearFilters}
              >
                清除
              </span>
            )}
          </div>

          {/* Sort */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ color: '#666', fontSize: '13px' }}>排序:</span>
            {sortOptions.map((opt) => {
              const selected = (params.sort_by || 'synced_at') === opt.value
              return (
                <span
                  key={opt.value}
                  style={{
                    cursor: 'pointer',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '13px',
                    color: selected ? '#1677ff' : '#666',
                    fontWeight: selected ? 500 : 400,
                  }}
                  onClick={() => {
                    if (selected) {
                      setParams((p) => ({ ...p, order: p.order === 'asc' ? 'desc' : 'asc' }))
                    } else {
                      setParams((p) => ({ ...p, sort_by: opt.value, page: 1 }))
                    }
                  }}
                >
                  {opt.label}
                  {selected && (
                    <span style={{ marginLeft: 2, fontSize: '12px' }}>
                      {params.order === 'asc' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                    </span>
                  )}
                </span>
              )
            })}
          </div>

          {/* Date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#666', fontSize: '13px' }}>时间:</span>
            <RangePicker
              size="small"
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
              <span style={{ color: '#999', fontSize: '12px', marginLeft: 'auto' }}>
                共 {data.total} 条对话
              </span>
            )}
          </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Tag color={platformColors[conv.platform]}>{conv.platform}</Tag>
                    <span style={{ fontWeight: 500 }}>{conv.title || 'Untitled'}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '12px', color: '#999', flexShrink: 0, marginLeft: '12px' }}>
                    <div>{conv.message_count} 条消息</div>
                    <div>同步: {dayjs(conv.synced_at).format('MM-DD HH:mm')} · 创建: {dayjs(conv.created_at).format('MM-DD HH:mm')}</div>
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
