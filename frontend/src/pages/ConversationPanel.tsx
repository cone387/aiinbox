import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin } from 'antd'
import { getConversation, listConversations, ListParams } from '../api/conversations'
import { search as searchApi, SearchParams as ApiSearchParams } from '../api/search'
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

export default function ConversationPanel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { searchKeyword } = useLayout()
  const PlatformIcon = usePlatformIcon()

  // List state
  const [convs, setConvs] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
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
  const listRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

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
      setHasMore(page < result.total_pages)
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
    setSelectedId(convId)
    loadDetail(convId)
    navigate(`/conversations/${convId}`)
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
      <div className="col-platform">
        <div className="col-title">平台</div>
        <div className="platform-list">
          {/* 全部 */}
          <div
            className={`platform-item ${!selectedPlatform ? 'active' : ''}`}
            onClick={() => selectPlatform(undefined)}
          >
            <span className="platform-icon"><PlatformIcon platform="" size={14} /></span>
            <span className="platform-label">全部</span>
            <span className="platform-count">{convs.length}</span>
          </div>
          {platformOptions.map((opt) => {
            const selected = selectedPlatform === opt.value
            const count = isSearch
              ? searchResults.filter(c => c.platform === opt.value).length
              : convs.filter(c => c.platform === opt.value).length
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
      </div>

      {/* Column 2: Conversation List */}
      <div className="col-list">
        {isSearch && searchResults.length > 0 && (
          <div className="search-info">
            搜索 "{searchKeyword}" — {searchResults.length} 个对话
          </div>
        )}
        <div ref={listRef} className="conversation-list-scroll" onScroll={handleScroll}>
          {activeLoading ? (
            <div style={{ textAlign: 'center', padding: '24px' }}><Spin size="small" /></div>
          ) : (
            <>
              {activeItems.map(conv => (
                <div
                  key={conv.id}
                  data-id={conv.id}
                  className={`conv-list-item ${conv.id === selectedId ? 'active' : ''}`}
                  onClick={() => handleSelect(conv.id)}
                >
                  <span className="conv-list-icon">
                    <PlatformIcon platform={conv.platform} size={14} />
                  </span>
                  <div className="conv-list-body">
                    <span className="conv-list-title">{conv.title || 'Untitled'}</span>
                    <span className="conv-list-meta">
                      {conv.message_count} 条 · {dayjs(conv.created_at).format('MM-DD HH:mm')}
                    </span>
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

      {/* Column 3: Content */}
      <div className="col-content">
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
