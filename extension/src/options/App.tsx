import { useEffect, useState } from 'react'
import { ExtensionConfig, ServerConfig, DEFAULT_CONFIG } from '../types'

function App() {
  const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [healthStatus, setHealthStatus] = useState<Record<number, boolean | null>>({})

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    const stored = await chrome.storage.local.get('config')
    if (stored.config) {
      // Migrate old config format if needed
      const cfg = stored.config as any
      if (!cfg.servers) {
        // Old format: convert to new
        const migrated: ExtensionConfig = {
          ...DEFAULT_CONFIG,
          servers: [{
            url: cfg.serverUrl || 'http://localhost:9531',
            token: cfg.authToken || '',
            name: 'Local',
            isDefault: true,
          }],
          enabledPlatforms: cfg.enabledPlatforms || DEFAULT_CONFIG.enabledPlatforms,
          syncMode: cfg.syncMode || 'realtime',
          batchInterval: cfg.batchInterval || 5,
          isCollecting: cfg.isCollecting ?? true,
        }
        await chrome.storage.local.set({ config: migrated })
        setConfig(migrated)
      } else {
        setConfig(cfg as ExtensionConfig)
      }
    }
  }

  async function saveConfig() {
    setSaving(true)
    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config })
      setMessage('\u914D\u7F6E\u5DF2\u4FDD\u5B58')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage('\u4FDD\u5B58\u5931\u8D25: ' + err)
    }
    setSaving(false)
  }

  async function checkHealth(index: number) {
    const server = config.servers[index]
    if (!server?.url) return
    setHealthStatus((s) => ({ ...s, [index]: null }))
    const resp = await chrome.runtime.sendMessage({ type: 'HEALTH_CHECK', url: server.url, token: server.token })
    setHealthStatus((s) => ({ ...s, [index]: resp?.server && resp?.auth ? true : false }))
  }

  function addServer() {
    setConfig((c) => ({
      ...c,
      servers: [...(c.servers || []), { url: '', token: '', name: '\u670D\u52A1 ' + ((c.servers?.length || 0) + 1), isDefault: false }],
    }))
  }

  function removeServer(index: number) {
    if ((config.servers?.length || 0) <= 1) return
    setConfig((c) => {
      const servers = (c.servers || []).filter((_, i) => i !== index)
      const activeIndex = c.activeServerIndex >= servers.length ? 0 : c.activeServerIndex
      return { ...c, servers, activeServerIndex: activeIndex }
    })
  }

  function updateServer(index: number, field: keyof ServerConfig, value: string) {
    setConfig((c) => {
      const servers = [...(c.servers || [])]
      servers[index] = { ...servers[index], [field]: value }
      return { ...c, servers }
    })
  }

  const servers = config.servers || []

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '24px' }}>AI Inbox \u8BBE\u7F6E</h1>

      {message && (
        <div style={{ padding: '8px 12px', marginBottom: '16px', backgroundColor: '#dcfce7', borderRadius: '6px', color: '#16a34a', fontSize: '13px' }}>
          {message}
        </div>
      )}

      <section style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '16px', margin: 0 }}>{'\u670D\u52A1\u5730\u5740\u7BA1\u7406'}</h2>
          <button onClick={addServer} style={{ padding: '4px 12px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'white' }}>
            + {'\u6DFB\u52A0'}
          </button>
        </div>

        {servers.map((server, index) => (
          <div key={index} style={{ padding: '12px', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '8px', backgroundColor: config.activeServerIndex === index ? '#f0f9ff' : 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="radio"
                  name="activeServer"
                  checked={config.activeServerIndex === index}
                  onChange={() => setConfig((c) => ({ ...c, activeServerIndex: index }))}
                />
                <input
                  type="text"
                  value={server.name}
                  onChange={(e) => updateServer(index, 'name', e.target.value)}
                  style={{ border: 'none', fontWeight: 500, fontSize: '14px', backgroundColor: 'transparent' }}
                />
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block',
                  backgroundColor: healthStatus[index] === true ? '#22c55e' : healthStatus[index] === false ? '#ef4444' : '#d1d5db',
                }} />
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => checkHealth(index)} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #d1d5db', borderRadius: '3px', cursor: 'pointer', backgroundColor: 'white' }}>
                  {'\u68C0\u6D4B'}
                </button>
                {servers.length > 1 && (
                  <button onClick={() => removeServer(index)} style={{ padding: '2px 8px', fontSize: '11px', border: '1px solid #fecaca', borderRadius: '3px', cursor: 'pointer', backgroundColor: '#fef2f2', color: '#dc2626' }}>
                    {'\u5220\u9664'}
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="url"
                value={server.url}
                onChange={(e) => updateServer(index, 'url', e.target.value)}
                placeholder="http://localhost:9531"
                style={{ flex: 2, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
              />
              <input
                type="password"
                value={server.token}
                onChange={(e) => updateServer(index, 'token', e.target.value)}
                placeholder="API Token"
                style={{ flex: 1, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
              />
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', marginBottom: '12px' }}>{'\u540C\u6B65\u8BBE\u7F6E'}</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px' }}>{'\u6A21\u5F0F\uFF1A'}</label>
          <select
            value={config.syncMode}
            onChange={(e) => setConfig((c) => ({ ...c, syncMode: e.target.value as 'realtime' | 'batch' }))}
            style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
          >
            <option value="realtime">{'\u5B9E\u65F6\u540C\u6B65'}</option>
            <option value="batch">{'\u5B9A\u65F6\u6279\u91CF'}</option>
          </select>
          {config.syncMode === 'batch' && (
            <>
              <label style={{ fontSize: '13px' }}>{'\u95F4\u9694\uFF1A'}</label>
              <input
                type="number"
                min={5}
                max={1440}
                value={config.batchInterval}
                onChange={(e) => setConfig((c) => ({ ...c, batchInterval: parseInt(e.target.value) || 5 }))}
                style={{ width: '60px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
              />
              <span style={{ fontSize: '13px', color: '#6b7280' }}>{'\u5206\u949F'}</span>
            </>
          )}
        </div>
      </section>

      <button onClick={saveConfig} disabled={saving} style={{
        padding: '10px 24px', fontSize: '14px', fontWeight: 500, border: 'none', borderRadius: '6px',
        backgroundColor: '#2563eb', color: 'white', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
      }}>
        {saving ? '\u4FDD\u5B58\u4E2D...' : '\u4FDD\u5B58\u914D\u7F6E'}
      </button>
    </div>
  )
}

export default App
