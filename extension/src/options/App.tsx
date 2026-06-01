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
          servers: [{ url: raw.serverUrl || 'http://localhost:9531', token: raw.authToken || '', name: '\u672C\u5730\u670D\u52A1', isDefault: true }],
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
      setMessage('\u8BF7\u5148\u586B\u5199\u670D\u52A1\u5730\u5740')
      return
    }
    setAuthorizing(index)
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'START_AUTH', url: server.url })
      if (resp?.ok) {
        setMessage('\u6388\u6743\u6210\u529F')
        await loadConfig()
        checkHealth(index)
        setTimeout(() => setMessage(''), 3000)
      } else {
        setMessage('\u6388\u6743\u5931\u8D25: ' + (resp?.error || 'unknown'))
      }
    } catch (err) {
      setMessage('\u6388\u6743\u51FA\u9519: ' + err)
    }
    setAuthorizing(null)
  }

  function addServer() {
    persist({ ...config, servers: [...(config.servers || []), { url: '', token: '', name: '\u670D\u52A1 ' + ((config.servers?.length || 0) + 1), isDefault: false }] })
  }

  function removeServer(index: number) {
    if ((config.servers?.length || 0) <= 1) return
    const servers = config.servers.filter((_, i) => i !== index)
    const activeIndex = config.activeServerIndex >= servers.length ? 0 : config.activeServerIndex
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

  const servers = config.servers || []

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '8px' }}>AI Inbox \u8BBE\u7F6E</h1>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
        {'\u914D\u7F6E\u4F60\u7684\u670D\u52A1\u5730\u5740\u5E76\u6388\u6743\u3002\u6388\u6743\u540E\u63D2\u4EF6\u4F1A\u81EA\u52A8\u8FDE\u63A5\uFF0C\u65E0\u9700\u624B\u52A8\u590D\u5236 Token\u3002'}
      </p>

      {message && (
        <div style={{ padding: '8px 12px', marginBottom: '16px', backgroundColor: '#dcfce7', borderRadius: '6px', color: '#16a34a', fontSize: '13px' }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '16px', margin: 0 }}>{'\u670D\u52A1\u5730\u5740'}</h2>
        <button onClick={addServer} style={{ padding: '4px 12px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white' }}>
          + {'\u6DFB\u52A0'}
        </button>
      </div>

      {servers.map((server, index) => {
        const h = health[index] || { server: null, auth: null }
        const authorized = !!server.token && h.auth === true
        return (
          <div key={index} style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '12px', backgroundColor: config.activeServerIndex === index ? '#f0f9ff' : 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <input type="radio" name="active" checked={config.activeServerIndex === index} onChange={() => persist({ ...config, activeServerIndex: index })} />
              <input type="text" value={server.name} onChange={(e) => updateServer(index, 'name', e.target.value)} onBlur={() => persist(config)}
                style={{ border: 'none', fontWeight: 500, fontSize: '14px', backgroundColor: 'transparent', flex: 1 }} placeholder={'\u670D\u52A1\u540D\u79F0'} />
              {servers.length > 1 && (
                <button onClick={() => removeServer(index)} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #fecaca', borderRadius: '3px', cursor: 'pointer', backgroundColor: '#fef2f2', color: '#dc2626' }}>
                  {'\u5220\u9664'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input type="url" value={server.url} onChange={(e) => updateServer(index, 'url', e.target.value)} onBlur={() => saveServerUrl(index)}
                placeholder="http://localhost:9531  \u6216  https://your-domain.com"
                style={{ flex: 1, padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }} />
            </div>

            {/* Status row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', backgroundColor: h.server === true ? '#22c55e' : h.server === false ? '#ef4444' : '#d1d5db' }} />
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{'\u670D\u52A1\u72B6\u6001'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', backgroundColor: h.auth === true ? '#22c55e' : h.auth === false ? '#ef4444' : '#d1d5db' }} />
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{'\u6388\u6743\u72B6\u6001'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => checkHealth(index)} style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white' }}>
                  {'\u5237\u65B0\u72B6\u6001'}
                </button>
                <button onClick={() => authorize(index)} disabled={authorizing === index}
                  style={{ padding: '6px 16px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: 'pointer', backgroundColor: authorized ? '#16a34a' : '#2563eb', color: 'white' }}>
                  {authorizing === index ? '\u6388\u6743\u4E2D...' : authorized ? '\u2713 \u5DF2\u6388\u6743\uFF08\u91CD\u65B0\u6388\u6743\uFF09' : '\u6388\u6743\u767B\u5F55'}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {/* Sync settings */}
      <div style={{ marginTop: '24px' }}>
        <h2 style={{ fontSize: '16px', marginBottom: '12px' }}>{'\u540C\u6B65\u8BBE\u7F6E'}</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px' }}>{'\u6A21\u5F0F\uFF1A'}</label>
          <select value={config.syncMode} onChange={(e) => persist({ ...config, syncMode: e.target.value as 'realtime' | 'batch' })}
            style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}>
            <option value="realtime">{'\u5B9E\u65F6\u540C\u6B65'}</option>
            <option value="batch">{'\u5B9A\u65F6\u6279\u91CF'}</option>
          </select>
          {config.syncMode === 'batch' && (
            <>
              <input type="number" min={5} max={1440} value={config.batchInterval}
                onChange={(e) => persist({ ...config, batchInterval: parseInt(e.target.value) || 5 })}
                style={{ width: '60px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }} />
              <span style={{ fontSize: '13px', color: '#6b7280' }}>{'\u5206\u949F'}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
