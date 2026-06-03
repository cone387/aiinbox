import { useEffect, useRef, useState } from 'react'

interface LogEntry {
  time: string
  level: string
  msg: string
}

const levelColors: Record<string, string> = {
  INFO: '#374151',
  WARN: '#d97706',
  ERROR: '#dc2626',
}

function App() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  async function loadLogs() {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_LOGS' })
    if (resp?.logs) setLogs(resp.logs)
  }

  async function clearLogs() {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' })
    setLogs([])
  }

  useEffect(() => {
    loadLogs()
    const interval = setInterval(loadLogs, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const filtered = filter
    ? logs.filter((l) => l.msg.toLowerCase().includes(filter.toLowerCase()))
    : logs

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', padding: '12px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>AI Inbox 日志</span>
        <span style={{ color: '#6b7280', fontSize: '11px' }}>{logs.length} 条</span>
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="过滤..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: '3px 6px', fontSize: '11px', border: '1px solid #d1d5db', borderRadius: '3px', width: '150px' }}
        />
        <label style={{ fontSize: '11px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          自动滚动
        </label>
        <button onClick={loadLogs} style={{ padding: '3px 8px', fontSize: '11px', border: '1px solid #d1d5db', borderRadius: '3px', cursor: 'pointer', backgroundColor: 'white' }}>
          刷新
        </button>
        <button onClick={clearLogs} style={{ padding: '3px 8px', fontSize: '11px', border: '1px solid #fca5a5', borderRadius: '3px', cursor: 'pointer', backgroundColor: '#fef2f2', color: '#dc2626' }}>
          清空
        </button>
      </div>
      <div
        ref={containerRef}
        style={{
          border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px',
          height: 'calc(100vh - 80px)', overflowY: 'auto', backgroundColor: '#fafafa',
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: '40px' }}>暂无日志</div>
        ) : (
          filtered.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', padding: '2px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {log.time.slice(11, 23)}
              </span>
              <span style={{ color: levelColors[log.level] || '#374151', fontWeight: 600, width: '40px', flexShrink: 0 }}>
                {log.level}
              </span>
              <span style={{ color: levelColors[log.level] || '#374151', wordBreak: 'break-all' }}>
                {log.msg}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App
