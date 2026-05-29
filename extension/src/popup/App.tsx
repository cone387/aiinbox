import { useEffect, useState } from 'react'
import { Platform, ExtensionConfig, ExtensionStatus } from '../types'
import { StorageStats } from '../storage/collector'

interface PopupState {
  status: ExtensionStatus
  isCollecting: boolean
  activePlatform: Platform | null
  config: ExtensionConfig | null
  stats: StorageStats | null
  serverHealthy: boolean | null
  loading: boolean
}

const platformLabels: Record<Platform, string> = {
  [Platform.ChatGPT]: 'ChatGPT',
  [Platform.Gemini]: 'Gemini',
  [Platform.Tongyi]: '通义千问',
  [Platform.Doubao]: '豆包',
}

function App() {
  const [state, setState] = useState<PopupState>({
    status: 'paused',
    isCollecting: false,
    activePlatform: null,
    config: null,
    stats: null,
    serverHealthy: null,
    loading: true,
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      if (!response) { setState((s) => ({ ...s, loading: false })); return }

      setState({
        status: response.status || 'paused',
        isCollecting: response.isCollecting || false,
        activePlatform: response.activePlatform || null,
        config: response.config || null,
        stats: response.stats || null,
        serverHealthy: null,
        loading: false,
      })

      // Check server health
      const cfg = response.config
      if (cfg?.servers?.length) {
        const server = cfg.servers[cfg.activeServerIndex || 0]
        if (server?.url) {
          const healthResp = await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK', url: server.url })
          setState((s) => ({ ...s, serverHealthy: healthResp?.healthy ?? false }))
        }
      }
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }

  async function toggleCollecting() {
    const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_COLLECTING' })
    setState((s) => ({
      ...s,
      isCollecting: response?.isCollecting ?? !s.isCollecting,
      status: response?.isCollecting ? 'active' : 'paused',
    }))
  }

  async function togglePlatform(platform: Platform) {
    const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_PLATFORM', platform })
    if (response?.enabledPlatforms && state.config) {
      setState((s) => ({
        ...s,
        config: { ...s.config!, enabledPlatforms: response.enabledPlatforms },
      }))
    }
  }

  function openOptions() {
    chrome.runtime.openOptionsPage()
  }

  if (state.loading) {
    return <div style={{ padding: '16px', textAlign: 'center', width: '340px' }}>加载中...</div>
  }

  const activeServer = state.config?.servers?.[state.config.activeServerIndex]

  return (
    <div style={{ width: '340px', padding: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600 }}>AI Inbox</span>
          <span style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
            backgroundColor: state.isCollecting ? '#22c55e' : '#9ca3af',
          }} />
        </div>
        <button onClick={toggleCollecting} style={{
          padding: '4px 10px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: 'pointer',
          backgroundColor: state.isCollecting ? '#fee2e2' : '#dcfce7',
          color: state.isCollecting ? '#dc2626' : '#16a34a',
        }}>
          {state.isCollecting ? '暂停' : '开始'}
        </button>
      </div>

      {/* Active Platform Detection */}
      <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>当前页面</div>
        {state.activePlatform ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block' }} />
            <span style={{ fontWeight: 500 }}>{platformLabels[state.activePlatform]}</span>
            <span style={{ color: '#22c55e', fontSize: '11px' }}>（正在监听）</span>
          </div>
        ) : (
          <span style={{ color: '#94a3b8' }}>非 AI 聊天页面</span>
        )}
      </div>

      {/* Server Status */}
      <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>服务</div>
            <div style={{ fontWeight: 500 }}>{activeServer?.name || '未配置'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block',
              backgroundColor: state.serverHealthy === true ? '#22c55e' : state.serverHealthy === false ? '#ef4444' : '#9ca3af',
            }} />
            <span style={{ fontSize: '11px', color: state.serverHealthy === true ? '#22c55e' : state.serverHealthy === false ? '#ef4444' : '#9ca3af' }}>
              {state.serverHealthy === true ? '正常' : state.serverHealthy === false ? '不可用' : '检测中'}
            </span>
          </div>
        </div>
      </div>

      {/* Platform Toggles */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>启用平台</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          {Object.values(Platform).map((platform) => {
            const enabled = state.config?.enabledPlatforms?.includes(platform) ?? true
            return (
              <button
                key={platform}
                onClick={() => togglePlatform(platform)}
                style={{
                  padding: '6px 8px', fontSize: '12px', border: '1px solid',
                  borderColor: enabled ? '#bfdbfe' : '#e2e8f0',
                  borderRadius: '4px', cursor: 'pointer',
                  backgroundColor: enabled ? '#eff6ff' : '#f8fafc',
                  color: enabled ? '#1d4ed8' : '#94a3b8',
                  fontWeight: enabled ? 500 : 400,
                }}
              >
                {platformLabels[platform]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stats */}
      {state.stats && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <div style={{ flex: 1, padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#16a34a' }}>{state.stats.totalConversations}</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>已收集</div>
          </div>
          <div style={{ flex: 1, padding: '8px', backgroundColor: '#fef3c7', borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#d97706' }}>{state.stats.pendingSync}</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>待同步</div>
          </div>
        </div>
      )}

      {/* Settings */}
      <button onClick={openOptions} style={{
        width: '100%', padding: '8px', fontSize: '12px', border: '1px solid #e2e8f0',
        borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer', color: '#374151',
      }}>
        ⚙️ 服务管理与高级设置
      </button>
    </div>
  )
}

export default App
