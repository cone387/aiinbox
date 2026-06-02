import { useEffect, useState } from 'react'
import { ExtensionConfig, ServerConfig, DEFAULT_CONFIG } from '../types'

interface HealthState {
  server: boolean | null
  auth: boolean | null
}

function App() {
  const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG)
  const [message, setMessage] = useState('')
  const [health, setHealth] = useState<Record<number, HealthState>>({})
  const [authorizing, setAuthorizing] = useState<number | null>(null)
  const [editingName, setEditingName] = useState<Record<number, boolean>>({})

  useEffect(() => {
    loadConfig().then((cfg) => {
      if (cfg) cfg.servers?.forEach((_, i) => checkHealth(i, cfg))
    })
  }, [])

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
          syncMode: raw.syncMode || 'realtime',
          batchInterval: raw.batchInterval || 5,
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
    // Focus the new server's URL input after render
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
          <p style={{ color: '#666', fontSize: '13px', margin: '4px 0 0' }}>
            配置服务地址并授权，授权后插件自动连接，无需手动复制 Token。
          </p>
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

      {/* Server list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {servers.map((server, index) => {
          const h = health[index] || { server: null, auth: null }
          const authorized = !!server.token && h.auth === true
          const isActive = config.activeServerIndex === index
          const isDefault = server.isDefault

          return (
            <div
              key={index}
              style={{
                padding: '14px 16px',
                border: isActive ? '1.5px solid #3b82f6' : '1px solid #e5e7eb',
                borderRadius: '8px',
                backgroundColor: isActive ? '#f8faff' : 'white',
              }}
            >
              {/* Header: name + active toggle + delete */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                {editingName[index] ? (
                  <input
                    type="text"
                    value={server.name}
                    onChange={(e) => updateServer(index, 'name', e.target.value)}
                    onBlur={() => { persist(config); setEditingName((e) => ({ ...e, [index]: false })) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { persist(config); setEditingName((e2) => ({ ...e2, [index]: false })) } }}
                    autoFocus
                    style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '2px 6px', fontSize: '14px', fontWeight: 500, flex: 1 }}
                    placeholder="服务名称"
                  />
                ) : (
                  <span
                    onClick={() => setEditingName((e) => ({ ...e, [index]: true }))}
                    style={{ fontWeight: 500, fontSize: '14px', cursor: 'pointer', flex: 1 }}
                    title="点击编辑名称"
                  >
                    {server.name || '未命名服务'}
                    {!isDefault && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '12px', marginLeft: '6px' }}>（点击编辑）</span>}
                  </span>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={isActive} onChange={() => setActiveServer(index)} />
                  启用
                </label>

                {!isDefault && (
                  <button onClick={() => removeServer(index)} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer', backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    删除
                  </button>
                )}
                {isDefault && (
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>默认</span>
                )}
              </div>

              {/* URL input */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  type="url"
                  data-server-url
                  value={server.url}
                  onChange={(e) => updateServer(index, 'url', e.target.value)}
                  onBlur={() => saveServerUrl(index)}
                  placeholder="http://localhost:9531  或  https://your-domain.com"
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace' }}
                />
              </div>

              {/* Status row */}
              {server.url && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: '14px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#64748b' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', backgroundColor: h.server === true ? '#22c55e' : h.server === false ? '#ef4444' : '#d1d5db' }} />
                      服务
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#64748b' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', backgroundColor: h.auth === true ? '#22c55e' : h.auth === false ? '#ef4444' : '#d1d5db' }} />
                      授权
                    </div>
                    {authorized && <span style={{ color: '#16a34a', fontWeight: 500 }}>✓ 已授权</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => checkHealth(index)} style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white', color: '#374151' }}>
                      刷新
                    </button>
                    <button onClick={() => authorize(index)} disabled={authorizing === index}
                      style={{ padding: '4px 14px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: authorized ? '#16a34a' : '#2563eb', color: 'white' }}>
                      {authorizing === index ? '授权中...' : authorized ? '重新授权' : '授权登录'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Sync settings */}
      <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
        <h2 style={{ fontSize: '15px', marginBottom: '10px' }}>同步设置</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#64748b' }}>模式：</span>
          <select value={config.syncMode} onChange={(e) => persist({ ...config, syncMode: e.target.value as 'realtime' | 'batch' })}
            style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}>
            <option value="realtime">实时同步</option>
            <option value="batch">定时批量</option>
          </select>
          {config.syncMode === 'batch' && (
            <>
              <input type="number" min={5} max={1440} value={config.batchInterval}
                onChange={(e) => persist({ ...config, batchInterval: parseInt(e.target.value) || 5 })}
                style={{ width: '60px', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }} />
              <span style={{ fontSize: '13px', color: '#6b7280' }}>分钟</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
