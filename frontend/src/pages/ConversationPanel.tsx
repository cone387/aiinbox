import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin } from 'antd'
import { getConversation, listConversations, ListParams, batchDelete } from '../api/conversations'
import { search as searchApi, SearchParams as ApiSearchParams } from '../api/search'
import { getSyncStatus, markRead, markAllRead, PlatformSyncStatus } from '../api/sync'
import { Conversation, ConversationDetail } from '../types'
import dayjs from 'dayjs'
import ConversationDetailContent from './ConversationDetailContent'
import { useLayout, usePlatformIcon } from '../components/Layout'
import './ConversationPanel.css'

const platformOptions = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'tongyi', label: '通义千问' },
  { value: 'doubao', label: '豆包' },
]

function getPlatformUrl(platform: string, conversationId: string): string | null {
  switch (platform) {
    case 'chatgpt': return `https://chatgpt.com/c/${conversationId}`
    case 'gemini': return `https://gemini.google.com/app/${conversationId}`
    case 'tongyi': return `https://tongyi.aliyun.com/qianwen/chat/${conversationId}`
    case 'doubao': return `https://www.doubao.com/chat/${conversationId}`
    default: return null
  }
}

const DeleteIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 1024 1024" width={size} height={size} fill="currentColor">
    <path d="M360 184h-8c4.4 0 8-3.6 8-8v8h304v-8c0 4.4 3.6 8 8 8h-8v72h72v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80h72v-72z M864 256H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.8 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32zM731.3 840H292.7l-24.2-512h487l-24.2 512z" />
  </svg>
)

const ExternalLinkIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 1024 1024" width={size} height={size} fill="currentColor">
    <path d="M864 160h-192c-17.7 0-32 14.3-32 32s14.3 32 32 32h114.7L521.4 489.4c-12.5 12.5-12.5 32.8 0 45.3 6.2 6.2 14.4 9.4 22.6 9.4s16.4-3.1 22.6-9.4L832 269.3V384c0 17.7 14.3 32 32 32s32-14.3 32-32V192c0-17.7-14.3-32-32-32z M736 512c-17.7 0-32 14.3-32 32v256H256V352h256c17.7 0 32-14.3 32-32s-14.3-32-32-32H224c-35.3 0-64 28.7-64 64v480c0 35.3 28.7 64 64 64h480c35.3 0 64-28.7 64-64V544c0-17.7-14.3-32-32-32z" />
  </svg>
)

const CollapseIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 1024 1024" width={size} height={size} fill="currentColor">
    <path d="M862.037333 171.093333A85.333333 85.333333 0 0 1 938.666667 256v512a85.333333 85.333333 0 0 1-76.629334 84.906667L853.333333 853.333333H170.666667a85.333333 85.333333 0 0 1-85.333334-85.333333V256a85.333333 85.333333 0 0 1 85.333334-85.333333h682.666666l8.704 0.426666zM170.666667 230.4a25.6 25.6 0 0 0-25.6 25.6v512a25.6 25.6 0 0 0 25.6 25.6h183.466666V230.4H170.666667z m243.2 563.2H853.333333a25.6 25.6 0 0 0 25.6-25.6V256a25.6 25.6 0 0 0-25.6-25.6H413.866667v563.2z" />
  </svg>
)

export default function ConversationPanel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { searchKeyword } = useLayout()
  const PlatformIcon = usePlatformIcon()
  const [platformCollapsed, setPlatformCollapsed] = useState(true)
  const [listCollapsed, setListCollapsed] = useState(false)

  // List state
  const [convs, setConvs] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [apiTotal, setApiTotal] = useState(0)
  const [platformCounts, setPlatformCounts] = useState<Record<string, number>>({})
  const [params, setParams] = useState<ListParams>({
    page: 1,
    page_size: 30,
    sort_by: 'created_at',
    order: 'desc',
  })

  // Search state
  const [searchResults, setSearchResults] = useState<Conversation[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [searchHasMore, setSearchHasMore] = useState(true)

  const [convDetail, setConvDetail] = useState<ConversationDetail | null>(null)
  const [wasUnread, setWasUnread] = useState(false)
  const [syncStatuses, setSyncStatuses] = useState<PlatformSyncStatus[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  // Fetch sync status
  useEffect(() => {
    getSyncStatus().then(setSyncStatuses).catch(() => {})
  }, [convs])

  function getUnreadCount(platform?: string): number {
    if (!platform) return syncStatuses.reduce((sum, s) => sum + s.unread_count, 0)
    return syncStatuses.find(s => s.platform === platform)?.unread_count || 0
  }

  // --- List API ---
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
      setApiTotal(prev => {
        const isAll = !params.platform || params.platform.length === 0
        return isAll ? result.total : prev
      })
      setHasMore(page < result.total_pages)
      // Update platform counts from "all" view loads
      if (!params.platform || params.platform.length === 0) {
        if (!append) setPlatformCounts({})
        const counts = result.items.reduce<Record<string, number>>((acc, c) => {
          acc[c.platform] = (acc[c.platform] || 0) + 1
          return acc
        }, {})
        setPlatformCounts(prev => {
          const merged = { ...prev }
          for (const [k, v] of Object.entries(counts)) {
            merged[k] = (merged[k] || 0) + v
          }
          return merged
        })
      }
    } catch {
      // Error handled by interceptor
    }
    setLoading(false)
    setLoadingMore(false)
    loadingRef.current = false
  }

  async function loadDetail(convId: number) {
    try {
      const data = await getConversation(convId)
      setConvDetail(data)
    } catch {
      // Error handled by interceptor
    }
  }

  // Load list when params change
  useEffect(() => {
    loadingRef.current = false
    loadPage(1)
  }, [params])

  // --- Search ---
  async function doSearch(keyword: string, page: number = 1, append = false) {
    if (!keyword || keyword.length < 2) {
      setSearchResults([])
      setSearchHasMore(false)
      return
    }
    setSearchLoading(true)
    try {
      const apiParams: ApiSearchParams = {
        q: keyword,
        page,
        page_size: 20,
      }
      if (params.platform && params.platform.length > 0) {
        apiParams.platform = params.platform
      }
      const result = await searchApi(apiParams)
      const seen = new Set<number>()
      const uniqueItems: Conversation[] = []
      for (const item of result.items) {
        const cid = item.conversation_id
        if (!seen.has(cid)) {
          seen.add(cid)
          uniqueItems.push({
            id: cid,
            platform: item.platform,
            conversation_id: String(cid),
            title: item.title,
            message_count: 0,
            created_at: item.created_at || '',
            updated_at: item.timestamp || '',
            synced_at: item.timestamp || '',
          })
        }
      }
      if (append) {
        setSearchResults(prev => [...prev, ...uniqueItems])
      } else {
        setSearchResults(uniqueItems)
      }
      setSearchHasMore(page * 20 < result.total)
      setSearchPage(page)
    } catch {
      // Error handled by interceptor
    }
    setSearchLoading(false)
  }

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (searchKeyword.length < 2) {
      setSearchResults([])
      setSearchHasMore(false)
      return
    }
    searchTimerRef.current = setTimeout(() => {
      doSearch(searchKeyword, 1)
    }, 300)
  }, [searchKeyword])

  // Auto-select first item
  useEffect(() => {
    const items = searchKeyword.length >= 2 ? searchResults : convs
    const isLoaded = searchKeyword.length >= 2 ? !searchLoading : !loading
    if (isLoaded && items.length > 0 && !selectedId && !id) {
      const firstId = items[0].id
      setSelectedId(firstId)
      navigate(`/conversations/${firstId}`, { replace: true })
    }
  }, [loading, searchLoading, convs, searchResults, searchKeyword])

  // Sync URL param to selectedId
  useEffect(() => {
    if (id) {
      const numId = parseInt(id)
      setSelectedId(numId)
      loadDetail(numId)
    }
  }, [id])

  // Scroll to selected item
  useEffect(() => {
    if (selectedId && listRef.current) {
      const el = listRef.current.querySelector(`[data-id="${selectedId}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedId])

  // Infinite scroll
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const items = searchKeyword.length >= 2 ? searchResults : convs
    const isSearch = searchKeyword.length >= 2
    if (items.length === 0) return

    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    const threshold = scrollHeight - scrollTop - clientHeight

    if (threshold < 100) {
      if (isSearch && searchHasMore && !searchLoading) {
        doSearch(searchKeyword, searchPage + 1, true)
      } else if (!isSearch && hasMore && !loadingMore && !loading) {
        const nextPage = (params.page || 1) + 1
        loadPage(nextPage, true)
      }
    }
  }

  function handleSelect(convId: number) {
    const conv = convs.find(c => c.id === convId)
    setWasUnread(conv?.has_unread ?? false)
    setSelectedId(convId)
    loadDetail(convId)
    navigate(`/conversations/${convId}`)
    markRead(convId).then(() => {
      setConvs(prev => prev.map(c => c.id === convId ? { ...c, has_unread: false } : c))
      getSyncStatus().then(setSyncStatuses).catch(() => {})
    }).catch(() => {})
  }

  function handleMarkAllRead() {
    markAllRead(selectedPlatform).then(() => {
      setConvs(prev => prev.map(c => ({ ...c, has_unread: false })))
      getSyncStatus().then(setSyncStatuses).catch(() => {})
    }).catch(() => {})
  }

  function handleDelete(e: React.MouseEvent, convId: number) {
    e.stopPropagation()
    if (!window.confirm('确定删除这个对话吗？')) return
    batchDelete([convId]).then(() => {
      setConvs(prev => prev.filter(c => c.id !== convId))
      if (selectedId === convId) {
        setSelectedId(null)
        setConvDetail(null)
      }
      getSyncStatus().then(setSyncStatuses).catch(() => {})
    }).catch(() => {})
  }

  function handleOpenOriginal(e: React.MouseEvent, conv: Conversation) {
    e.stopPropagation()
    const url = getPlatformUrl(conv.platform, conv.conversation_id)
    if (url) window.open(url, '_blank')
  }

  function selectPlatform(platform: string | undefined) {
    setParams(prev => ({ ...prev, platform: platform ? [platform] : undefined, page: 1 }))
    setSelectedId(null)
    setConvDetail(null)
    if (searchKeyword.length >= 2) {
      setTimeout(() => doSearch(searchKeyword, 1), 0)
    }
  }

  const isSearch = searchKeyword.length >= 2
  const activeItems = isSearch ? searchResults : convs
  const activeLoading = isSearch ? searchLoading : loading
  const activeLoadingMore = isSearch ? searchLoading : loadingMore
  const selectedPlatform = params.platform?.[0]

  return (
    <div className="conversation-panel">
      {/* Column 1: Platform */}
      <div className={`col-platform ${platformCollapsed ? 'collapsed' : ''}`}>
        <div className="col-title">
          {!platformCollapsed && <span>平台</span>}
          <button className="sidebar-toggle-btn" onClick={() => setPlatformCollapsed(!platformCollapsed)} title={platformCollapsed ? '展开平台' : '折叠平台'}>
            <CollapseIcon size={16} />
          </button>
        </div>
        {platformCollapsed ? (
        <div className="platform-list-collapsed">
          <div
            className={`platform-icon-item ${!selectedPlatform ? 'active' : ''}`}
            onClick={() => selectPlatform(undefined)}
            title="全部"
          >
            <PlatformIcon platform="" size={16} />
            {getUnreadCount() > 0 && <span className="unread-badge">{getUnreadCount()}</span>}
          </div>
          {platformOptions.map((opt) => (
            <div
              key={opt.value}
              className={`platform-icon-item ${selectedPlatform === opt.value ? 'active' : ''}`}
              onClick={() => selectPlatform(opt.value)}
              title={opt.label}
            >
              <PlatformIcon platform={opt.value} size={16} />
              {getUnreadCount(opt.value) > 0 && <span className="unread-badge">{getUnreadCount(opt.value)}</span>}
            </div>
          ))}
        </div>
        ) : (
        <div className="platform-list">
          {/* 全部 */}
          <div
            className={`platform-item ${!selectedPlatform ? 'active' : ''}`}
            onClick={() => selectPlatform(undefined)}
          >
            <span className="platform-icon"><PlatformIcon platform="" size={14} /></span>
            <span className="platform-label">全部</span>
            {getUnreadCount() > 0 ? <span className="unread-badge">{getUnreadCount()}</span> : <span className="platform-count">{apiTotal || convs.length}</span>}
          </div>
          {platformOptions.map((opt) => {
            const selected = selectedPlatform === opt.value
            const count = platformCounts[opt.value] ?? 0
            return (
              <div
                key={opt.value}
                className={`platform-item ${selected ? 'active' : ''}`}
                onClick={() => selectPlatform(opt.value)}
              >
                <span className="platform-icon"><PlatformIcon platform={opt.value} size={14} /></span>
                <span className="platform-label">{opt.label}</span>
                <span className="platform-count">{count}</span>
              </div>
            )
          })}
        </div>
        )}
      </div>

      {/* Column 2: Conversation List */}
      {!listCollapsed && (
      <div className="col-list">
        <div className="col-list-header">
          {isSearch && searchResults.length > 0 ? (
            <span className="search-info">搜索 "{searchKeyword}" — {searchResults.length} 个对话</span>
          ) : (
            <span className="col-list-title-text">对话</span>
          )}
          {getUnreadCount(selectedPlatform) > 0 && (
            <button className="mark-all-read-btn" onClick={handleMarkAllRead} title="全部标记已读">
              全部已读
            </button>
          )}
        </div>
        <div ref={listRef} className="conversation-list-scroll" onScroll={handleScroll}>
          {activeLoading ? (
            <div style={{ textAlign: 'center', padding: '24px' }}><Spin size="small" /></div>
          ) : activeItems.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-text">
                {isSearch
                  ? `没有找到包含 "${searchKeyword}" 的对话`
                  : selectedPlatform
                    ? `${platformOptions.find(o => o.value === selectedPlatform)?.label || selectedPlatform} 暂无对话`
                    : '暂无对话'}
              </div>
            </div>
          ) : (
            <>
              {activeItems.map(conv => (
                <div
                  key={conv.id}
                  data-id={conv.id}
                  className={`conv-list-item ${conv.id === selectedId ? 'active' : ''}`}
                  onClick={() => handleSelect(conv.id)}
                >
                  {!selectedPlatform && (
                  <span className="conv-list-icon">
                    <PlatformIcon platform={conv.platform} size={14} />
                  </span>
                  )}
                  <div className="conv-list-body">
                    <span className="conv-list-title">{conv.title || 'Untitled'}</span>
                    <span className="conv-list-meta">
                      {conv.message_count} 条 · {dayjs(conv.created_at).format('MM-DD HH:mm')}
                    </span>
                  </div>
                  {conv.has_unread && <span className="conv-unread-dot" />}
                  <div className="conv-list-actions">
                    <button className="conv-action-btn" onClick={(e) => handleOpenOriginal(e, conv)} title="跳转原对话">
                      <ExternalLinkIcon size={13} />
                    </button>
                    <button className="conv-action-btn conv-action-delete" onClick={(e) => handleDelete(e, conv.id)} title="删除">
                      <DeleteIcon size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {activeLoadingMore && (
                <div className="conv-list-loading">
                  <Spin size="small" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Column 3: Content */}
      <div className="col-content">
        {listCollapsed && !convDetail && (
          <div className="content-toggle-bar">
            <button className="sidebar-toggle-btn" onClick={() => setListCollapsed(false)} title="展开对话列表">
              <CollapseIcon size={18} />
            </button>
          </div>
        )}
        {convDetail ? (
          <ConversationDetailContent conv={convDetail} listCollapsed={listCollapsed} onToggleList={() => setListCollapsed(!listCollapsed)} wasUnread={wasUnread} />
        ) : activeItems.length === 0 && !activeLoading ? (
          <div className="panel-empty">
            <div className="panel-empty-text">
              {isSearch
                ? `没有搜索到 "${searchKeyword}"`
                : selectedPlatform
                  ? `${platformOptions.find(o => o.value === selectedPlatform)?.label} 暂无对话`
                  : '选择平台中的对话开始'}
            </div>
          </div>
        ) : (
          <div className="panel-empty">
            <div className="panel-empty-text">选择一个对话开始</div>
          </div>
        )}
      </div>
    </div>
  )
}
