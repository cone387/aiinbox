import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin } from 'antd'
import { getConversation, listConversations, ListParams } from '../api/conversations'
import { Conversation, ConversationDetail } from '../types'
import dayjs from 'dayjs'
import ConversationDetailContent from './ConversationDetailContent'
import './ConversationPanel.css'

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

export default function ConversationPanel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [convs, setConvs] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [params, setParams] = useState<ListParams>({
    page: 1,
    page_size: 20,
    sort_by: 'synced_at',
    order: 'desc',
  })
  const [convDetail, setConvDetail] = useState<ConversationDetail | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  // Load first page
  async function loadPage(page: number, append = false) {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      if (append) setLoadingMore(true)
      else setLoading(true)
      const result = await listConversations({ ...params, page })
      if (append) {
        setConvs(prev => [...prev, ...result.items])
      } else {
        setConvs(result.items)
      }
      setHasMore(page < result.total_pages)
    } catch {
      // Error handled by interceptor
    }
    setLoading(false)
    setLoadingMore(false)
    loadingRef.current = false
  }

  // Load detail
  async function loadDetail(convId: number) {
    try {
      const data = await getConversation(convId)
      setConvDetail(data)
    } catch {
      // Error handled by interceptor
    }
  }

  // Load when params change
  useEffect(() => {
    loadingRef.current = false
    loadPage(1)
  }, [params])

  // Auto-select first conversation on initial load
  useEffect(() => {
    if (!loading && convs.length > 0 && !selectedId && !id) {
      const firstId = convs[0].id
      setSelectedId(firstId)
      navigate(`/conversations/${firstId}`, { replace: true })
    }
  }, [loading, convs])

  // Sync URL param to selectedId
  useEffect(() => {
    if (id) {
      const numId = parseInt(id)
      setSelectedId(numId)
      loadDetail(numId)
    }
  }, [id])

  // Scroll to selected item in list
  useEffect(() => {
    if (selectedId && listRef.current) {
      const el = listRef.current.querySelector(`[data-id="${selectedId}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedId])

  // Infinite scroll
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !loadingMore && !loading) {
      const nextPage = (params.page || 1) + 1
      loadPage(nextPage, true)
    }
  }

  function handleSelect(convId: number) {
    setSelectedId(convId)
    loadDetail(convId)
    navigate(`/conversations/${convId}`)
  }

  function handleParamsChange(newParams: Partial<ListParams>) {
    setParams(prev => ({ ...prev, ...newParams, page: 1 }))
    setSelectedId(null)
    setConvDetail(null)
  }

  function togglePlatform(platform: string) {
    const current = params.platform || []
    const next = current.includes(platform)
      ? current.filter((x) => x !== platform)
      : [...current, platform]
    handleParamsChange({ platform: next.length > 0 ? next : undefined })
  }

  function clearFilters() {
    handleParamsChange({
      platform: undefined,
      start_time: undefined,
      end_time: undefined,
    })
  }

  const hasFilters = (params.platform && params.platform.length > 0) || params.start_time || params.end_time

  return (
    <div className="conversation-panel">
      {/* Sidebar */}
      <div className="panel-sidebar">
        <div className="sidebar-filters">
          <div className="filter-row">
            <span className="filter-label">平台:</span>
            {platformOptions.map((opt) => {
              const selected = params.platform?.includes(opt.value)
              return (
                <span
                  key={opt.value}
                  className={`filter-chip ${selected ? 'selected' : ''}`}
                  style={selected ? { background: platformColors[opt.value], color: '#fff' } : {}}
                  onClick={() => togglePlatform(opt.value)}
                >
                  {opt.label}
                </span>
              )
            })}
            {hasFilters && (
              <span className="clear-btn" onClick={clearFilters}>清除</span>
            )}
          </div>
          <div className="filter-row">
            <span className="filter-label">排序:</span>
            {sortOptions.map((opt) => {
              const selected = (params.sort_by || 'synced_at') === opt.value
              return (
                <span
                  key={opt.value}
                  className={`filter-chip sort-chip ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    if (selected) {
                      handleParamsChange({ order: params.order === 'asc' ? 'desc' : 'asc' })
                    } else {
                      handleParamsChange({ sort_by: opt.value })
                    }
                  }}
                >
                  {opt.label}
                  {selected && (
                    <span className="sort-arrow">
                      {params.order === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
          <div className="filter-row">
            <span className="filter-label">时间:</span>
            <input
              type="text"
              placeholder="开始时间"
              className="filter-date"
              value={params.start_time ? dayjs(params.start_time).format('YYYY-MM-DD') : ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) {
                  handleParamsChange({ start_time: dayjs(v).toISOString(), end_time: params.end_time })
                } else {
                  handleParamsChange({ start_time: undefined })
                }
              }}
            />
            <span style={{ color: '#999' }}>-</span>
            <input
              type="text"
              placeholder="结束时间"
              className="filter-date"
              value={params.end_time ? dayjs(params.end_time).format('YYYY-MM-DD') : ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) {
                  handleParamsChange({ end_time: dayjs(v).toISOString() })
                } else {
                  handleParamsChange({ end_time: undefined })
                }
              }}
            />
          </div>
        </div>

        {/* Conversation list */}
        <div ref={listRef} className="conversation-list-scroll" onScroll={handleScroll}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px' }}><Spin size="small" /></div>
          ) : (
            <>
              {convs.map(conv => (
                <div
                  key={conv.id}
                  data-id={conv.id}
                  className={`conv-list-item ${conv.id === selectedId ? 'active' : ''}`}
                  onClick={() => handleSelect(conv.id)}
                >
                  <span className="conv-list-title">{conv.title || 'Untitled'}</span>
                  <span className="conv-list-meta">
                    {conv.platform} · {conv.message_count} 条 · {dayjs(conv.created_at).format('MM-DD HH:mm')}
                  </span>
                </div>
              ))}
              {loadingMore && (
                <div className="conv-list-loading">
                  <Spin size="small" />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="panel-content">
        {convDetail ? (
          <ConversationDetailContent conv={convDetail} />
        ) : (
          <div className="panel-empty">
            <div className="panel-empty-text">选择一个对话开始</div>
          </div>
        )}
      </div>
    </div>
  )
}
