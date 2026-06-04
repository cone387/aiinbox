import { useEffect, useState, useRef, useCallback } from 'react'
import { Platform, ExtensionConfig, ExtensionStatus, PLATFORMS, DEFAULT_CONFIG } from '../types'
import { platformLabels, platformUrls, PlatformIcon } from '../shared/platforms'

interface CacheStat { total: number; pending: number; synced: number; failed: number }

interface PopupState {
  status: ExtensionStatus
  isCollecting: boolean
  activePlatform: Platform | null
  config: ExtensionConfig
  serverOk: boolean | null
  authOk: boolean | null
  loading: boolean
  platformCounts: Record<string, number>
  cacheStats: { total: number; pending: number; synced: number; failed: number; lastSyncTime: string | null; byPlatform: Record<string, CacheStat> }
}

function App() {
  const [state, setState] = useState<PopupState>({
    status: 'paused',
    isCollecting: false,
    activePlatform: null,
    config: DEFAULT_CONFIG,
    serverOk: null,
    authOk: null,
    loading: true,
    platformCounts: {},
    cacheStats: { total: 0, pending: 0, synced: 0, failed: 0, lastSyncTime: null, byPlatform: {} },
  })

  const configRef = useRef(state.config)
  configRef.current = state.config

  const doHealthCheck = useCallback(async (cfg?: ExtensionConfig) => {
    const c = cfg || configRef.current
    const server = c.servers?.[c.activeServerIndex || 0]
    if (!server?.url) return

    async function check() {
      return await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK', url: server!.url, token: server!.token })
    }

    // Retry up to 3 times with increasing delays
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await check()
        if (resp?.server) {
          setState((s) => ({ ...s, serverOk: resp.server, authOk: resp.auth }))
          return
        }
      } catch {}

      // Wait before retry: 300ms, 600ms, 900ms
      await new Promise((r) => setTimeout(r, (attempt + 1) * 300))
    }

    // All retries failed
    setState((s) => ({ ...s, serverOk: false, authOk: false }))
  }, [])

  const loadPlatformCounts = useCallback(async (cfg: ExtensionConfig) => {
    const server = cfg.servers?.[cfg.activeServerIndex || 0]
    if (!server?.url || !server?.token) return
    try {
      const resp = await fetch(`${server.url}/api/v1/stats/overview`, {
        headers: { 'Authorization': `Bearer ${server.token}` },
        signal: AbortSignal.timeout(5000),
      })
      if (resp.ok) {
        const data = await resp.json()
        setState((s) => ({ ...s, platformCounts: data.platform_distribution || {} }))
      }
    } catch {}
  }, [])

  async function loadCacheStats() {
    try {
      const stats = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' })
      if (stats && typeof stats.total === 'number') {
        setState((s) => ({ ...s, cacheStats: stats }))
      }
    } catch {}
  }

  async function handleExport(platform?: Platform) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'EXPORT_DATA',
        format: 'json',
        filter: platform ? { platform } : undefined,
      })
      if (resp?.data) {
        const blob = new Blob([resp.data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const suffix = platform ? `-${platform}` : ''
        a.download = `aiinbox-export${suffix}-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch {}
  }

  const loadData = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      if (!response) { setState((s) => ({ ...s, loading: false })); return }

      const cfg = response.config || DEFAULT_CONFIG
      const health = response.health || { server: true, auth: true }
      setState((s) => ({
        ...s,
        status: response.status || 'paused',
        isCollecting: response.isCollecting || false,
        activePlatform: response.activePlatform || null,
        config: cfg,
        serverOk: health.server,
        authOk: health.auth,
        loading: false,
      }))

      loadPlatformCounts(cfg)
      loadCacheStats()
      doHealthCheck(cfg)
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [doHealthCheck, loadPlatformCounts])

  useEffect(() => {
    loadData()
    const interval = setInterval(() => doHealthCheck(), 60000)

    const handler = (changes: Record<string, any>, namespace: string) => {
      if (namespace === 'local' && changes.config) {
        loadData()
      }
    }
    chrome.storage.onChanged.addListener(handler)

    return () => {
      clearInterval(interval)
      chrome.storage.onChanged.removeListener(handler)
    }
  }, [loadData, doHealthCheck])

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
    if (response?.enabledPlatforms) {
      setState((s) => ({ ...s, config: { ...s.config, enabledPlatforms: response.enabledPlatforms } }))
    }
  }

  if (state.loading) {
    return <div style={{ padding: '16px', textAlign: 'center', width: '340px' }}>加载中...</div>
  }

  const activeServer = state.config.servers?.[state.config.activeServerIndex || 0]
  const enabledPlatforms = state.config.enabledPlatforms || []

  return (
    <div style={{ width: '340px', padding: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600 }}>AI Inbox</span>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: state.isCollecting ? '#22c55e' : '#9ca3af' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/logs/index.html') })}
            style={{ padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', color: '#6b7280' }}
            title="查看日志"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </button>
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            style={{ padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', color: '#6b7280' }}
            title="设置"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button onClick={toggleCollecting} style={{
            padding: '4px 10px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: 'pointer',
            backgroundColor: state.isCollecting ? '#fee2e2' : '#dcfce7',
            color: state.isCollecting ? '#dc2626' : '#16a34a',
          }}>
            {state.isCollecting ? '暂停' : '开始'}
          </button>
        </div>
      </div>

      {/* Current page */}
      <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>当前页面</div>
        {state.activePlatform ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block' }} />
            <span style={{ fontWeight: 500 }}>{platformLabels[state.activePlatform]}</span>
            <span style={{ color: '#22c55e', fontSize: '11px' }}>（监听中）</span>
          </div>
        ) : (
          <span style={{ color: '#94a3b8' }}>非 AI 聊天页面</span>
        )}
      </div>

      {/* Server status */}
      <div style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>服务</div>
            <div style={{ fontWeight: 500, fontSize: '12px' }}>{activeServer?.name || '未配置'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block', backgroundColor: state.serverOk === true ? '#22c55e' : state.serverOk === false ? '#ef4444' : '#d1d5db' }} />
              <div style={{ fontSize: '9px', color: '#6b7280' }}>服务</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block', backgroundColor: state.authOk === true ? '#22c55e' : state.authOk === false ? '#ef4444' : '#d1d5db' }} />
              <div style={{ fontSize: '9px', color: '#6b7280' }}>Token</div>
            </div>
            {state.authOk === null && (
              <span style={{ fontSize: '10px', color: '#9ca3af' }}>检测中</span>
            )}
            {state.authOk === true && (
              <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 500 }}>✓ 已授权</span>
            )}
            {state.authOk === false && state.serverOk === true && (
              <span style={{ fontSize: '10px', color: activeServer?.token ? '#ef4444' : '#d97706' }}>
                {activeServer?.token ? '授权失效' : '需要授权'}
              </span>
            )}
            <button onClick={() => doHealthCheck()} style={{ padding: '2px 6px', fontSize: '10px', border: '1px solid #d1d5db', borderRadius: '3px', cursor: 'pointer', backgroundColor: 'white' }}>
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* Platform toggles */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>启用平台</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {PLATFORMS.map((platform) => {
            const enabled = enabledPlatforms.includes(platform)
            const count = state.platformCounts[platform] || 0
            const cache = state.cacheStats.byPlatform[platform]
            return (
              <div key={platform} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '5px 8px', borderRadius: '4px',
              }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '8px', flex: 1, cursor: 'pointer', minWidth: 0,
                }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => togglePlatform(platform)}
                    style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                  />
                  <PlatformIcon platform={platform} size={18} />
                  <span style={{ fontSize: '12px', color: '#374151' }}>
                    {platformLabels[platform]}
                  </span>
                </label>
                {cache && cache.total > 0 ? (
                  <span style={{ fontSize: '11px', color: cache.synced === cache.total ? '#16a34a' : '#d97706' }} title="本地缓存已同步 / 总数">
                    {cache.synced}/{cache.total} 已同步
                  </span>
                ) : count > 0 ? (
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    {count} 条
                  </span>
                ) : null}
                {cache && cache.total > 0 && (
                  <button
                    onClick={() => handleExport(platform)}
                    style={{
                      padding: '2px 6px', fontSize: '11px', border: '1px solid #e2e8f0',
                      borderRadius: '3px', backgroundColor: 'white', cursor: 'pointer', color: '#6b7280',
                    }}
                    title={`导出 ${platformLabels[platform]} 数据`}
                  >
                    ↓
                  </button>
                )}
                <button
                  onClick={() => chrome.tabs.create({ url: platformUrls[platform] })}
                  style={{
                    padding: '2px 6px', fontSize: '11px', border: '1px solid #e2e8f0',
                    borderRadius: '3px', backgroundColor: 'white', cursor: 'pointer',
                    color: '#3b82f6',
                  }}
                  title={`打开 ${platformLabels[platform]}`}
                >
                  ↗
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default App
