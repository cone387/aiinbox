import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input, Card, Empty, Spin, Tag, Select } from 'antd'
import { search, SearchResponse } from '../api/search'

const platformOptions = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'tongyi', label: '通义千问' },
  { value: 'doubao', label: '豆包' },
]

export default function Search() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [platforms, setPlatforms] = useState<string[]>([])

  const debounceTimer = { current: null as ReturnType<typeof setTimeout> | null }

  const doSearch = useCallback(async (q: string, plats: string[]) => {
    if (q.length < 2) {
      setResults(null)
      return
    }
    setLoading(true)
    try {
      const data = await search({ q, platform: plats.length ? plats : undefined })
      setResults(data)
    } catch {
      // handled by interceptor
    }
    setLoading(false)
  }, [])

  function handleInputChange(value: string) {
    setKeyword(value)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => doSearch(value, platforms), 300)
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '16px' }}>全文搜索</h2>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <Input.Search
          placeholder="输入关键词搜索对话内容（至少2个字符）"
          value={keyword}
          onChange={(e) => handleInputChange(e.target.value)}
          onSearch={(v) => doSearch(v, platforms)}
          size="large"
          style={{ flex: 1 }}
        />
        <Select
          mode="multiple"
          placeholder="平台"
          options={platformOptions}
          style={{ minWidth: 150 }}
          onChange={(v) => { setPlatforms(v); doSearch(keyword, v) }}
          allowClear
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px' }}><Spin /></div>
      ) : results === null ? (
        <Empty description="输入关键词开始搜索" />
      ) : results.items.length === 0 ? (
        <Empty description="未找到匹配结果" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ color: '#666', fontSize: '13px' }}>找到 {results.total} 条结果</p>
          {results.items.map((item, idx) => (
            <Card
              key={idx}
              hoverable
              size="small"
              onClick={() => navigate(`/conversations/${item.conversation_id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ marginBottom: '4px' }}>
                <Tag>{item.platform}</Tag>
                <span style={{ fontWeight: 500 }}>{item.title}</span>
              </div>
              <p
                style={{ margin: 0, fontSize: '13px', color: '#666' }}
                dangerouslySetInnerHTML={{ __html: item.context }}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
