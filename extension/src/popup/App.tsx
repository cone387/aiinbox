import { useEffect, useState } from 'react'
import { Platform, ExtensionConfig, ExtensionStatus, PLATFORMS, DEFAULT_CONFIG } from '../types'

interface StorageStats {
  totalConversations: number
  pendingSync: number
  byPlatform: Record<string, number>
}

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
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  tongyi: '\u901A\u4E49\u5343\u95EE',
  doubao: '\u8C46\u5305',
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
        config: response.config || DEFAULT_CONFIG,
        stats: response.stats || null,
        serverHealthy: null,
        loading: false,
      })

      const cfg = response.config || DEFAULT_CONFIG
      if (cfg.servers?.length) {
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
    return <div style={{ padding: '16px', textAlign: 'center', width: '340px' }}>{'\u52A0\u8F7D\u4E2D...'}</div>
  }

  const activeServer = state.config?.servers?.[state.config?.activeServerIndex || 0]
  const enabledPlatforms = state.config?.enabledPlatforms || DEFAULT_CONFIG.enabledPlatforms

  return (
    <div style={{ width: '340px', padding: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px' }}>
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
          {state.isCollecting ? '\u6682\u505C' : '\u5F00\u59CB'}
        </button>
      </div>

      <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{'\u5F53\u524D\u9875\u9762'}</div>
        {state.activePlatform ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block' }} />
            <span style={{ fontWeight: 500 }}>{platformLabels[state.activePlatform]}</span>
            <span style={{ color: '#22c55e', fontSize: '11px' }}>{'\uFF08\u6B63\u5728\u76D1\u542C\uFF09'}</span>
          </div>
        ) : (
          <span style={{ color: '#94a3b8' }}>{'\u975E AI \u804A\u5929\u9875\u9762'}</span>
        )}
      </div>

      <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>{'\u670D\u52A1'}</div>
            <div style={{ fontWeight: 500 }}>{activeServer?.name || '\u672A\u914D\u7F6E'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block',
              backgroundColor: state.serverHealthy === true ? '#22c55e' : state.serverHealthy === false ? '#ef4444' : '#9ca3af',
            }} />
            <span style={{ fontSize: '11px', color: state.serverHealthy === true ? '#22c55e' : state.serverHealthy === false ? '#ef4444' : '#9ca3af' }}>
              {state.serverHealthy === true ? '\u6B63\u5E38' : state.serverHealthy === false ? '\u4E0D\u53EF\u7528' : '...'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>{'\u542F\u7528\u5E73\u53F0'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          {PLATFORMS.map((platform) => {
            const enabled = enabledPlatforms.includes(platform)
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

      {state.stats && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <div style={{ flex: 1, padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#16a34a' }}>{state.stats.totalConversations}</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>{'\u5DF2\u6536\u96C6'}</div>
          </div>
          <div style={{ flex: 1, padding: '8px', backgroundColor: '#fef3c7', borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#d97706' }}>{state.stats.pendingSync}</div>
            <div style={{ fontSize: '10px', color: '#6b7280' }}>{'\u5F85\u540C\u6B65'}</div>
          </div>
        </div>
      )}

      <button onClick={openOptions} style={{
        width: '100%', padding: '8px', fontSize: '12px', border: '1px solid #e2e8f0',
        borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer', color: '#374151',
      }}>
        {'\u2699\uFE0F \u670D\u52A1\u7BA1\u7406\u4E0E\u9AD8\u7EA7\u8BBE\u7F6E'}
      </button>
    </div>
  )
}

export default App
