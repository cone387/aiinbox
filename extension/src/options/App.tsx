import { useEffect, useState, useRef } from 'react'
import { ExtensionConfig, ServerConfig, DEFAULT_CONFIG, Platform, PLATFORMS } from '../types'
import { platformLabels, PlatformIcon, ExportIcon } from '../shared/platforms'

interface HealthState {
  server: boolean | null
  auth: boolean | null
}

interface CacheStat { total: number; pending: number; synced: number; failed: number }
type ExportFormat = 'json' | 'markdown'

function App() {
  const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG)
  const [message, setMessage] = useState('')
  const [health, setHealth] = useState<Record<number, HealthState>>({})
  const [authorizing, setAuthorizing] = useState<number | null>(null)
  const [editingName, setEditingName] = useState<Record<number, boolean>>({})
  const [cacheTotal, setCacheTotal] = useState<CacheStat>({ total: 0, pending: 0, synced: 0, failed: 0 })
  const [serverStats, setServerStats] = useState<Record<number, CacheStat>>({})
  const [cacheByPlatform, setCacheByPlatform] = useState<Record<string, CacheStat>>({})
  const [exportPlatform, setExportPlatform] = useState<Platform | 'all'>('all')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json')
  const [exporting, setExporting] = useState(false)
  const [syncingServer, setSyncingServer] = useState<number | null>(null)
  const [syncProgress, setSyncProgress] = useState<Record<number, { current: number; total: number; success: number; failed: number }>>({})
  const [syncResult, setSyncResult] = useState<Record<number, { success: number; failed: number; errors: string[] }>>({})
  const [showGuide, setShowGuide] = useState(false)
  const [cacheSize, setCacheSize] = useState<string>('')
  const configRef = useRef<ExtensionConfig>(DEFAULT_CONFIG)

  async function estimateCacheSize() {
    try {
      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage || 0
      // Format size
      if (usage < 1024) setCacheSize(`${usage} B`)
      else if (usage < 1024 * 1024) setCacheSize(`${(usage / 1024).toFixed(1)} KB`)
      else setCacheSize(`${(usage / 1024 / 1024).toFixed(1)} MB`)
    } catch {
      setCacheSize('')
    }
  }

  // Load persisted sync states from background
  async function loadPersistedSyncStates(cfg: ExtensionConfig) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATES' })
      if (!resp?.states) return
      const states = resp.states as Record<string, { progress: any; result: any; updatedAt: string }>
      if (!cfg.servers) return
      let hasActiveSync = false
      for (let i = 0; i < cfg.servers.length; i++) {
        const serverUrl = cfg.servers[i]?.url
        if (!serverUrl || !states[serverUrl]) continue
        const state = states[serverUrl]
        // Only load progress (for progress bar), not result (to avoid stale data)
        if (state.progress && !state.result) {
          setSyncProgress(prev => ({ ...prev, [i]: state.progress }))
          hasActiveSync = true
        }
      }
      // If any sync is still active, set syncingServer to show progress
      if (hasActiveSync) {
        for (let i = 0; i < cfg.servers.length; i++) {
          const serverUrl = cfg.servers[i]?.url
          if (serverUrl && states[serverUrl]?.progress && !states[serverUrl]?.result) {
            setSyncingServer(i)
            break
          }
        }
      }
      // Clear persisted state after loading (avoid stale data on next load)
      chrome.storage.local.remove('syncStates')
    } catch {}
  }

  function setupGlobalSyncListener() {
    const listener = (msg: any) => {
      if (msg.type !== 'SYNC_PROGRESS' && msg.type !== 'SYNC_COMPLETE') return
      const serverUrl = msg.serverUrl as string
      if (!serverUrl) return
      // Find the index for this server using configRef
      const cfg = configRef.current
      const index = cfg.servers?.findIndex(s => s.url === serverUrl)
      if (index === undefined || index < 0) return

      if (msg.type === 'SYNC_PROGRESS') {
        setSyncProgress(prev => ({ ...prev, [index]: { current: msg.current, total: msg.total, success: msg.success || 0, failed: msg.failed || 0 } }))
      }
      if (msg.type === 'SYNC_COMPLETE') {
        setSyncResult(prev => ({ ...prev, [index]: { success: msg.success, failed: msg.failed, errors: msg.errors || [] } }))
        setSyncingServer(null)
        reloadAllStats()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
  }

  // Keep configRef in sync with config
  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    loadConfig().then((cfg) => {
      if (cfg) {
        cfg.servers?.forEach((_, i) => checkHealth(i, cfg))
        // Load stats for each server
        cfg.servers?.forEach((s, i) => {
          if (s.url) loadServerStats(i, s.url, s.token)
        })
        // Show guide if no server is configured or not authorized
        const hasValidServer = cfg.servers?.some(s => s.url && s.token)
        if (!hasValidServer && !cfg.offlineMode) {
          setShowGuide(true)
        }
        // Load persisted sync states and set up global listener
        loadPersistedSyncStates(cfg)
        setupGlobalSyncListener()
      }
    })
    loadGlobalStatistics()
    estimateCacheSize()
  }, [])

  async function loadGlobalStatistics() {
    try {
      const stats = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' })
      if (stats && typeof stats.total === 'number') {
        setCacheTotal({ total: stats.total, pending: stats.pending, synced: stats.synced, failed: stats.failed })
        setCacheByPlatform(stats.byPlatform || {})
      }
    } catch {}
  }

  async function loadServerStats(index: number, serverUrl: string, token?: string) {
    if (!token) {
      // No token, fall back to local-only stats with per-server filtering
      try {
        const stats = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS', serverUrl })
        if (stats && typeof stats.total === 'number') {
          setServerStats(prev => ({ ...prev, [index]: { total: stats.total, pending: stats.pending, synced: stats.synced, failed: stats.failed } }))
        }
      } catch {}
      return
    }
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'GET_SERVER_SYNC_STATUS',
        serverUrl,
        token,
      })
      if (resp?.ok) {
        setServerStats(prev => ({ ...prev, [index]: { total: resp.total, pending: resp.pending, synced: resp.synced, failed: resp.failed } }))
      } else {
        // Server unreachable, fall back to local stats with per-server filtering
        const stats = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS', serverUrl })
        if (stats && typeof stats.total === 'number') {
          setServerStats(prev => ({ ...prev, [index]: { total: stats.total, pending: stats.total, synced: 0, failed: stats.failed || 0 } }))
        }
      }
    } catch {}
  }

  function reloadAllStats() {
    loadGlobalStatistics()
    estimateCacheSize()
    config.servers?.forEach((s, i) => {
      if (s.url) loadServerStats(i, s.url, s.token)
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      const filter = exportPlatform === 'all' ? undefined : { platform: exportPlatform }
      const resp = await chrome.runtime.sendMessage({ type: 'EXPORT_DATA', format: exportFormat, filter })
      if (resp?.data) {
        const mime = exportFormat === 'markdown' ? 'text/markdown' : 'application/json'
        const ext = exportFormat === 'markdown' ? 'md' : 'json'
        const blob = new Blob([resp.data], { type: mime })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const suffix = exportPlatform === 'all' ? '' : `-${exportPlatform}`
        a.download = `aiinbox-export${suffix}-${new Date().toISOString().slice(0, 10)}.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        setMessage('没有可导出的数据')
        setTimeout(() => setMessage(''), 3000)
      }
    } catch (err) {
      setMessage('导出失败: ' + err)
    }
    setExporting(false)
  }

  // Clear persisted sync state for a specific server
  async function clearPersistedSyncState(serverUrl: string) {
    try {
      const stored = await chrome.storage.local.get('syncStates')
      const states = (stored.syncStates || {}) as Record<string, any>
      if (states[serverUrl]) {
        delete states[serverUrl]
        await chrome.storage.local.set({ syncStates: states })
      }
    } catch {}
  }

  function handleSyncNow(index: number) {
    const serverUrl = config.servers?.[index]?.url
    if (!serverUrl) return
    const stats = serverStats[index] || { total: 0, pending: 0, synced: 0, failed: 0 }
    setSyncingServer(index)
    setSyncProgress(prev => ({ ...prev, [index]: { current: 0, total: stats.pending, success: 0, failed: 0 } }))
    setSyncResult(prev => { const next = { ...prev }; delete next[index]; return next })
    // Clear persisted state for this server (new sync will re-persist)
    clearPersistedSyncState(serverUrl)

    // Global listener handles SYNC_PROGRESS and SYNC_COMPLETE
    chrome.runtime.sendMessage({ type: 'RETRY_FAILED', serverUrl })
  }

  function handleRetryFailed(index: number) {
    handleSyncNow(index)
  }

  async function loadConfig(): Promise<ExtensionConfig | null> {
    const stored = await chrome.storage.local.get('config')
    let cfg: ExtensionConfig
    if (stored.config) {
      const raw = stored.config as any
      if (!raw.servers) {
        cfg = {
          ...DEFAULT_CONFIG,
          servers: [{ url: raw.serverUrl || 'http://localhost:9531', token: raw.authToken || '', name: '本地服务', isDefault: true }],
          enabledPlatforms: raw.enabledPlatforms || DEFAULT_CONFIG.enabledPlatforms,
          isCollecting: raw.isCollecting ?? true,
        }
        await chrome.storage.local.set({ config: cfg })
      } else {
        cfg = raw as ExtensionConfig
      }
    } else {
      cfg = DEFAULT_CONFIG
    }
    setConfig(cfg)
    return cfg
  }

  async function persist(next: ExtensionConfig) {
    setConfig(next)
    await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: next })
  }

  function toggleOffline() {
    persist({ ...config, offlineMode: !config.offlineMode })
  }

  async function checkHealth(index: number, cfg?: ExtensionConfig) {
    const c = cfg || config
    const server = c.servers[index]
    if (!server?.url) return
    setHealth((h) => ({ ...h, [index]: { server: null, auth: null } }))
    const resp = await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK', url: server.url, token: server.token })
    setHealth((h) => ({ ...h, [index]: { server: resp?.server ?? false, auth: resp?.auth ?? false } }))
  }

  async function authorize(index: number) {
    const server = config.servers[index]
    if (!server?.url) {
      setMessage('请先填写服务地址')
      return
    }
    setAuthorizing(index)
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'START_AUTH', url: server.url })
      if (resp?.ok) {
        setMessage('授权成功')
        await loadConfig()
        checkHealth(index)
        setTimeout(() => setMessage(''), 3000)
      } else {
        setMessage('授权失败: ' + (resp?.error || 'unknown'))
      }
    } catch (err) {
      setMessage('授权出错: ' + err)
    }
    setAuthorizing(null)
  }

  function addServer() {
    const newServers = [...(config.servers || []), { url: '', token: '', name: '我的服务', isDefault: false }]
    const next = { ...config, servers: newServers, activeServerIndex: newServers.length - 1 }
    persist(next)
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('input[data-server-url]')
      inputs[inputs.length - 1]?.focus()
    }, 100)
  }

  function removeServer(index: number) {
    const server = config.servers[index]
    if (server?.isDefault) return
    const servers = config.servers.filter((_, i) => i !== index)
    let activeIndex = config.activeServerIndex
    if (activeIndex === index) activeIndex = 0
    else if (activeIndex > index) activeIndex--
    persist({ ...config, servers, activeServerIndex: activeIndex })
  }

  function updateServer(index: number, field: keyof ServerConfig, value: string) {
    const servers = [...config.servers]
    servers[index] = { ...servers[index], [field]: value }
    setConfig({ ...config, servers })
  }

  function saveServerUrl(index: number) {
    persist(config)
    checkHealth(index)
    const server = config.servers?.[index]
    if (server?.url) loadServerStats(index, server.url, server.token)
  }

  function setActiveServer(index: number) {
    persist({ ...config, activeServerIndex: index })
  }

  const servers = config.servers || []

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div>
          <h1 style={{ fontSize: '20px', margin: 0 }}>AI Inbox 设置</h1>
        </div>
        <button onClick={addServer} style={{ padding: '6px 14px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'white', whiteSpace: 'nowrap' }}>
          + 添加服务
        </button>
      </div>

      {message && (
        <div style={{ padding: '8px 12px', marginBottom: '16px', backgroundColor: '#dcfce7', borderRadius: '6px', color: '#16a34a', fontSize: '13px' }}>
          {message}
        </div>
      )}

      {/* First-time user guide */}
      {showGuide && (
        <div style={{ padding: '16px', marginBottom: '16px', border: '2px solid #3b82f6', borderRadius: '8px', backgroundColor: '#eff6ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: '15px', color: '#1e40af' }}>👋 欢迎使用 AI Inbox</div>
            <button onClick={() => setShowGuide(false)} style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white', color: '#3b82f6' }}>关闭</button>
          </div>
          <div style={{ fontSize: '13px', color: '#1e40af', lineHeight: 1.8 }}>
            <div style={{ marginBottom: '8px' }}><strong>快速开始：</strong></div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>🌐 方案一：连接本地服务（推荐）</div>
                <div style={{ fontSize: '12px', color: '#3b82f6' }}>
                  1. 下载并启动 AI Inbox 服务端<br />2. 在下方填写服务地址<br />3. 点击"授权登录"<br />4. 自动同步所有对话
                </div>
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontWeight: 500, marginBottom: '4px' }}>💾 方案二：离线模式</div>
                <div style={{ fontSize: '12px', color: '#3b82f6' }}>
                  1. 开启下方"离线模式"<br />2. 自动捕获对话到本地<br />3. 随时导出数据<br />4. 无需任何服务端
                </div>
              </div>
            </div>
            <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#dbeafe', borderRadius: '4px', fontSize: '12px' }}>
              💡 <strong>提示：</strong>建议使用方案一，可以享受搜索、统计等完整功能。离线模式仅适合临时使用。
            </div>
          </div>
        </div>
      )}

      {/* Offline mode toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '14px 16px', marginBottom: '16px', border: config.offlineMode ? '1.5px solid #3b82f6' : '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: config.offlineMode ? '#f8faff' : 'white' }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: '14px' }}>离线模式</div>
          <div style={{ color: '#666', fontSize: '12px', marginTop: '2px' }}>
            仅捕获到浏览器本地存储，不连接任何服务端。数据通过下方"数据导出"取出。
          </div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0, cursor: 'pointer' }}>
          <input type="checkbox" checked={config.offlineMode} onChange={toggleOffline} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{ position: 'absolute', inset: 0, borderRadius: '22px', transition: '0.2s', backgroundColor: config.offlineMode ? '#3b82f6' : '#cbd5e1' }} />
          <span style={{ position: 'absolute', top: '3px', left: config.offlineMode ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'white', transition: '0.2s' }} />
        </label>
      </div>

      {/* Server list (hidden in offline mode) */}
      {config.offlineMode ? (
        <div style={{ padding: '12px 16px', marginBottom: '16px', border: '1px dashed #d1d5db', borderRadius: '8px', color: '#94a3b8', fontSize: '13px' }}>
          离线模式已开启，无需配置服务端。
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {servers.map((server, index) => {
          const h = health[index] || { server: null, auth: null }
          const authorized = !!server.token && h.auth === true
          const isActive = config.activeServerIndex === index
          const isDefault = server.isDefault
          const ss = serverStats[index] || { total: 0, pending: 0, synced: 0, failed: 0 }
          const isSyncing = syncingServer === index
          const sp = syncProgress[index] || null
          const sr = syncResult[index] || null

          return (
            <div key={index} style={{ padding: '14px 16px', border: isActive ? '1.5px solid #3b82f6' : '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: isActive ? '#f8faff' : 'white' }}>
              {/* Header: name + active toggle + delete */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                {editingName[index] ? (
                  <input type="text" value={server.name}
                    onChange={(e) => updateServer(index, 'name', e.target.value)}
                    onBlur={() => { persist(config); setEditingName((e) => ({ ...e, [index]: false })) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { persist(config); setEditingName((e2) => ({ ...e2, [index]: false })) } }}
                    autoFocus style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '2px 6px', fontSize: '14px', fontWeight: 500, flex: 1 }} placeholder="服务名称" />
                ) : (
                  <span onClick={() => setEditingName((e) => ({ ...e, [index]: true }))} style={{ fontWeight: 500, fontSize: '14px', cursor: 'pointer', flex: 1 }} title="点击编辑名称">
                    {server.name || '未命名服务'}
                    {!isDefault && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '12px', marginLeft: '6px' }}>（点击编辑）</span>}
                  </span>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={isActive} onChange={() => setActiveServer(index)} />启用
                </label>
                {!isDefault && <button onClick={() => removeServer(index)} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#fef2f2', color: '#dc2626' }}>删除</button>}
                {isDefault && <span style={{ fontSize: '11px', color: '#94a3b8' }}>默认</span>}
              </div>

              {/* URL input */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input type="url" data-server-url value={server.url}
                  onChange={(e) => updateServer(index, 'url', e.target.value)}
                  onBlur={() => saveServerUrl(index)}
                  placeholder="http://localhost:9531  或  https://your-domain.com"
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace' }} />
              </div>

              {/* Status row */}
              {server.url && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#64748b' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', backgroundColor: h.server === true ? '#22c55e' : h.server === false ? '#ef4444' : '#d1d5db' }} />服务
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#64748b' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', backgroundColor: h.auth === true ? '#22c55e' : h.auth === false ? '#ef4444' : '#d1d5db' }} />授权
                    </div>
                    {authorized && <span style={{ color: '#16a34a', fontWeight: 500 }}>✓ 已授权</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => checkHealth(index)} style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white', color: '#374151' }}>刷新</button>
                    <button onClick={() => authorize(index)} disabled={authorizing === index}
                      style={{ padding: '4px 14px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: authorized ? '#16a34a' : '#2563eb', color: 'white' }}>
                      {authorizing === index ? '授权中...' : authorized ? '重新授权' : '授权登录'}
                    </button>
                  </div>
                </div>
              )}

              {/* Per-server Sync Status */}
              {server.url && ss.total > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #e2e8f0' }}>
                  <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: '#374151', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <span>总计: <strong>{ss.total}</strong></span>
                    <span style={{ color: ss.pending > 0 ? '#d97706' : '#16a34a' }}>待同步: <strong>{ss.pending}</strong></span>
                    <span style={{ color: '#16a34a' }}>已同步: <strong>{ss.synced}</strong></span>
                    {ss.failed > 0 && <span style={{ color: '#dc2626' }}>失败: <strong>{ss.failed}</strong></span>}
                  </div>

                  {/* Sync progress/result */}
                  {(sp || sr) && (
                    <div style={{ marginBottom: '8px', padding: '8px 10px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      {sp && !sr && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                            <span>同步进度</span>
                            <span>{sp.current}/{sp.total} ({sp.total > 0 ? Math.round((sp.current / sp.total) * 100) : 0}%)</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden', marginBottom: '6px' }}>
                            <div style={{ width: `${sp.total > 0 ? (sp.current / sp.total) * 100 : 0}%`, height: '100%', backgroundColor: '#2563eb', transition: 'width 0.3s ease' }} />
                          </div>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#64748b' }}>
                            <span>成功: <strong style={{ color: '#16a34a' }}>{sp.success}</strong></span>
                            {sp.failed > 0 && <span>失败: <strong style={{ color: '#dc2626' }}>{sp.failed}</strong></span>}
                          </div>
                        </div>
                      )}
                      {sr && (
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: sr.failed > 0 ? '#d97706' : '#16a34a' }}>
                            {sr.failed > 0 ? '⚠️ 同步完成（部分失败）' : '✅ 同步完成'}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                            成功: <strong style={{ color: '#16a34a' }}>{sr.success}</strong>
                            {sr.failed > 0 && <span> | 失败: <strong style={{ color: '#dc2626' }}>{sr.failed}</strong></span>}
                          </div>
                          {sr.errors && sr.errors.length > 0 && (
                            <div style={{ padding: '6px', backgroundColor: '#fef2f2', borderRadius: '4px', border: '1px solid #fecaca', marginBottom: '6px' }}>
                              {sr.errors.slice(0, 3).map((error, idx) => (
                                <div key={idx} style={{ fontSize: '10px', color: '#991b1b', fontFamily: 'monospace' }}>• {error}</div>
                              ))}
                              {sr.errors.length > 3 && <div style={{ fontSize: '10px', color: '#991b1b' }}>... 还有 {sr.errors.length - 3} 个错误</div>}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => { setSyncResult(prev => { const next = { ...prev }; delete next[index]; return next }); setSyncProgress(prev => { const next = { ...prev }; delete next[index]; return next }); clearPersistedSyncState(server.url || ''); reloadAllStats() }}
                              style={{ padding: '3px 10px', fontSize: '11px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white', color: '#374151' }}>关闭</button>
                            {sr.failed > 0 && (
                              <button onClick={() => handleRetryFailed(index)} style={{ padding: '3px 10px', fontSize: '11px', border: '1px solid #fde68a', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#fffbeb', color: '#d97706' }}>重试失败项</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button onClick={() => handleSyncNow(index)} disabled={isSyncing || ss.pending === 0}
                      style={{ padding: '4px 12px', fontSize: '12px', border: 'none', borderRadius: '5px', cursor: isSyncing || ss.pending === 0 ? 'not-allowed' : 'pointer', backgroundColor: ss.pending === 0 ? '#cbd5e1' : '#2563eb', color: 'white', fontWeight: 500 }}>
                      {isSyncing ? '同步中...' : '立即同步'}
                    </button>
                    {isSyncing && (
                      <button onClick={async () => { await chrome.runtime.sendMessage({ type: 'CANCEL_SYNC' }); setSyncingServer(null); setSyncProgress(prev => { const next = { ...prev }; delete next[index]; return next }); setSyncResult(prev => { const next = { ...prev }; delete next[index]; return next }); clearPersistedSyncState(server.url || ''); setMessage('已取消同步'); setTimeout(() => setMessage(''), 3000); setTimeout(reloadAllStats, 1000) }}
                        style={{ padding: '4px 12px', fontSize: '12px', border: '1px solid #fecaca', borderRadius: '5px', cursor: 'pointer', backgroundColor: '#fef2f2', color: '#dc2626' }}>取消</button>
                    )}
                    {ss.failed > 0 && (
                      <button onClick={() => handleRetryFailed(index)} disabled={isSyncing}
                        style={{ padding: '4px 12px', fontSize: '12px', border: '1px solid #fde68a', borderRadius: '5px', cursor: isSyncing ? 'not-allowed' : 'pointer', backgroundColor: isSyncing ? '#f3f4f6' : '#fffbeb', color: isSyncing ? '#9ca3af' : '#d97706' }}>
                        重试失败 ({ss.failed})
                      </button>
                    )}
                    <button onClick={() => loadServerStats(index, server.url, server.token)} disabled={isSyncing}
                      style={{ padding: '4px 12px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '5px', cursor: isSyncing ? 'not-allowed' : 'pointer', backgroundColor: isSyncing ? '#f3f4f6' : 'white', color: isSyncing ? '#9ca3af' : '#374151' }}>刷新</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* Server setup hint */}
      {!config.offlineMode && health[config.activeServerIndex || 0]?.server === false && (
        <div style={{ marginTop: '-4px', marginBottom: '16px', padding: '14px 16px', border: '1px solid #fde68a', borderRadius: '8px', backgroundColor: '#fffbeb' }}>
          <div style={{ fontWeight: 500, fontSize: '13px', color: '#92400e', marginBottom: '6px' }}>连接不到服务端？</div>
          <div style={{ fontSize: '12px', color: '#92400e', lineHeight: 1.7 }}>
            <div>1. 从 <a href="https://github.com/cone387/aiinbox/releases/latest" target="_blank" rel="noreferrer" style={{ color: '#b45309', fontWeight: 500 }}>发布页</a> 下载对应平台的服务端程序（单文件，无需安装）。</div>
            <div>2. 双击运行，它会在 <code style={{ background: '#fef3c7', padding: '0 4px', borderRadius: '3px' }}>http://localhost:9531</code> 启动并自带网页界面。</div>
            <div>3. 把上方服务地址填为该地址，点"刷新"确认连通后再"授权登录"。</div>
            <div style={{ marginTop: '4px', color: '#a16207' }}>或开启上方"离线模式"，仅本地捕获、随时导出，无需任何服务端。</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: '28px' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 4px' }}>数据导出</h2>
        <p style={{ color: '#666', fontSize: '13px', margin: '0 0 12px' }}>
          导出本地缓存的对话数据（共 {cacheTotal.total} 条
          {config.offlineMode ? (
            <span style={{ color: '#3b82f6' }}>，已离线捕获</span>
          ) : (
            <>
              {cacheTotal.pending > 0 && <span style={{ color: '#d97706' }}>，待同步 {cacheTotal.pending}</span>}
              {cacheTotal.failed > 0 && <span style={{ color: '#ef4444' }}>，失败 {cacheTotal.failed}</span>}
            </>
          )}
          ）。
        </p>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>选择平台</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            <button onClick={() => setExportPlatform('all')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px', border: exportPlatform === 'all' ? '1.5px solid #3b82f6' : '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', backgroundColor: exportPlatform === 'all' ? '#f8faff' : 'white' }}>
              全部 <span style={{ color: '#94a3b8' }}>{cacheTotal.total}</span>
            </button>
            {PLATFORMS.map((platform) => {
              const c = cacheByPlatform[platform]
              const active = exportPlatform === platform
              return (
                <button key={platform} onClick={() => setExportPlatform(platform)} disabled={!c || c.total === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px', border: active ? '1.5px solid #3b82f6' : '1px solid #d1d5db', borderRadius: '6px', cursor: !c || c.total === 0 ? 'not-allowed' : 'pointer', backgroundColor: active ? '#f8faff' : 'white', opacity: !c || c.total === 0 ? 0.45 : 1 }}>
                  <PlatformIcon platform={platform} size={18} />
                  {platformLabels[platform]}
                  <span style={{ color: config.offlineMode ? '#94a3b8' : (c && c.synced === c.total ? '#16a34a' : '#94a3b8') }}>
                    {c ? (config.offlineMode ? c.total : `${c.synced}/${c.total}`) : 0}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: '13px', color: '#374151', marginBottom: '8px' }}>导出格式</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {(['json', 'markdown'] as ExportFormat[]).map((fmt) => (
              <button key={fmt} onClick={() => setExportFormat(fmt)}
                style={{ padding: '6px 16px', fontSize: '13px', border: exportFormat === fmt ? '1.5px solid #3b82f6' : '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', backgroundColor: exportFormat === fmt ? '#f8faff' : 'white' }}>
                {fmt === 'json' ? 'JSON' : 'Markdown'}
              </button>
            ))}
          </div>
          <button onClick={handleExport} disabled={exporting || cacheTotal.total === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '13px', border: 'none', borderRadius: '6px', cursor: exporting || cacheTotal.total === 0 ? 'not-allowed' : 'pointer', backgroundColor: cacheTotal.total === 0 ? '#cbd5e1' : '#2563eb', color: 'white', fontWeight: 500 }}>
            <ExportIcon size={14} />
            {exporting ? '导出中...' : '导出数据'}
          </button>
          <button onClick={reloadAllStats}
            style={{ marginLeft: '8px', padding: '8px 14px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'white', color: '#374151' }}>
            刷新统计
          </button>
          {cacheTotal.synced > 0 && (
            <button onClick={async () => {
              if (!confirm(`确定清除 ${cacheTotal.synced} 条已同步的本地缓存吗？\n服务端数据不受影响，仅清除本地缓存。`)) return
              const activeServer = config.servers?.[config.activeServerIndex || 0]
              if (!activeServer?.url) return
              const resp = await chrome.runtime.sendMessage({ type: 'CLEAR_SYNCED', serverUrl: activeServer.url })
              if (resp?.ok) {
                setMessage(`已清除 ${resp.deleted || 0} 条本地缓存`)
                setTimeout(() => setMessage(''), 3000)
                reloadAllStats()
              }
            }}
              style={{ marginLeft: '8px', padding: '8px 14px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', backgroundColor: 'white', color: '#6b7280' }}>
              清除已同步缓存
            </button>
          )}
          {cacheSize && (
            <span style={{ marginLeft: '8px', fontSize: '12px', color: '#94a3b8' }}>缓存大小: {cacheSize}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
