import { useEffect, useState } from 'react'
import { collector, StorageStats } from '../storage/collector'
import { ExtensionStatus } from '../types'

interface PopupState {
  status: ExtensionStatus
  stats: StorageStats | null
  loading: boolean
}

function App() {
  const [state, setState] = useState<PopupState>({
    status: 'paused',
    stats: null,
    loading: true,
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Get status from background
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      const stats = await collector.getStats()

      setState({
        status: response?.status || 'paused',
        stats,
        loading: false,
      })
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }

  async function toggleCollecting() {
    const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_COLLECTING' })
    setState((s) => ({
      ...s,
      status: response?.isCollecting ? 'active' : 'paused',
    }))
  }

  function openOptions() {
    chrome.runtime.openOptionsPage()
  }

  const statusColors: Record<ExtensionStatus, string> = {
    active: '#22c55e',
    paused: '#9ca3af',
    error: '#ef4444',
  }

  const statusLabels: Record<ExtensionStatus, string> = {
    active: '正在收集',
    paused: '已暂停',
    error: '错误',
  }

  if (state.loading) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '16px' }}>AI Chat Collector</h2>
        <div
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: statusColors[state.status],
          }}
          title={statusLabels[state.status]}
        />
      </div>

      {/* Status */}
      <div style={{ marginBottom: '16px', padding: '8px', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>状态: {statusLabels[state.status]}</span>
          <button
            onClick={toggleCollecting}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              backgroundColor: state.status === 'active' ? '#fee2e2' : '#dcfce7',
              color: state.status === 'active' ? '#dc2626' : '#16a34a',
            }}
          >
            {state.status === 'active' ? '暂停' : '开始'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {state.stats && (
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>收集统计</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <StatCard label="总对话数" value={state.stats.totalConversations} />
            <StatCard label="待同步" value={state.stats.pendingSync} />
          </div>
          {Object.keys(state.stats.byPlatform).length > 0 && (
            <div style={{ marginTop: '8px' }}>
              {Object.entries(state.stats.byPlatform).map(([platform, count]) => (
                <div
                  key={platform}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}
                >
                  <span style={{ color: '#6b7280' }}>{platform}</span>
                  <span style={{ fontWeight: 500 }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings link */}
      <button
        onClick={openOptions}
        style={{
          width: '100%',
          padding: '8px',
          fontSize: '13px',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          backgroundColor: 'white',
          cursor: 'pointer',
          color: '#374151',
        }}
      >
        ⚙️ 设置
      </button>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: '8px', backgroundColor: '#f9fafb', borderRadius: '4px', textAlign: 'center' }}>
      <div style={{ fontSize: '18px', fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#6b7280' }}>{label}</div>
    </div>
  )
}

export default App
