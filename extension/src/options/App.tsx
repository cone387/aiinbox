import { useEffect, useState } from 'react'
import { Platform, ExtensionConfig } from '../types'
import { secureStorage } from '../utils/crypto'

const DEFAULT_CONFIG: ExtensionConfig = {
  serverUrl: '',
  authToken: '',
  syncMode: 'realtime',
  batchInterval: 5,
  enabledPlatforms: [Platform.ChatGPT, Platform.Gemini, Platform.Tongyi, Platform.Doubao],
  isCollecting: true,
}

function App() {
  const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    const stored = await chrome.storage.local.get('config')
    if (stored.config) {
      const cfg = stored.config as ExtensionConfig
      // Decrypt token for display
      if (cfg.authToken) {
        try {
          cfg.authToken = await secureStorage.decrypt(cfg.authToken)
        } catch {
          // Already plain or decryption failed
        }
      }
      setConfig(cfg)
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}

    if (!config.serverUrl) {
      errs.serverUrl = '服务地址不能为空'
    } else if (!config.serverUrl.startsWith('https://') && !config.serverUrl.startsWith('http://localhost')) {
      errs.serverUrl = '服务地址必须以 https:// 开头（本地开发可用 http://localhost）'
    } else if (config.serverUrl.includes(' ')) {
      errs.serverUrl = '服务地址不能包含空格'
    }

    if (!config.authToken) {
      errs.authToken = '认证令牌不能为空'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function saveConfig() {
    if (!validate()) return

    setSaving(true)
    try {
      // Encrypt token before saving
      const encryptedToken = await secureStorage.encrypt(config.authToken)
      const toSave = { ...config, authToken: encryptedToken }

      await chrome.storage.local.set({ config: toSave })
      await chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' })

      setMessage('配置已保存')
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setMessage('保存失败: ' + err)
    }
    setSaving(false)
  }

  function togglePlatform(platform: Platform) {
    setConfig((c) => ({
      ...c,
      enabledPlatforms: c.enabledPlatforms.includes(platform)
        ? c.enabledPlatforms.filter((p) => p !== platform)
        : [...c.enabledPlatforms, platform],
    }))
  }

  const platformLabels: Record<Platform, string> = {
    [Platform.ChatGPT]: 'ChatGPT',
    [Platform.Gemini]: 'Gemini',
    [Platform.Tongyi]: '通义千问',
    [Platform.Doubao]: '豆包',
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '24px' }}>AI Chat Collector 设置</h1>

      {message && (
        <div style={{ padding: '8px 12px', marginBottom: '16px', backgroundColor: '#dcfce7', borderRadius: '6px', color: '#16a34a', fontSize: '13px' }}>
          {message}
        </div>
      )}

      {/* Server URL */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
          服务地址
        </label>
        <input
          type="url"
          value={config.serverUrl}
          onChange={(e) => setConfig((c) => ({ ...c, serverUrl: e.target.value }))}
          placeholder="https://your-server.com"
          style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        />
        {errors.serverUrl && <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>{errors.serverUrl}</p>}
      </div>

      {/* Auth Token */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
          认证令牌 (API Token)
        </label>
        <input
          type="password"
          value={config.authToken}
          onChange={(e) => setConfig((c) => ({ ...c, authToken: e.target.value }))}
          placeholder="aic_xxxxxxxx"
          style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        />
        {errors.authToken && <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>{errors.authToken}</p>}
      </div>

      {/* Sync Mode */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
          同步模式
        </label>
        <select
          value={config.syncMode}
          onChange={(e) => setConfig((c) => ({ ...c, syncMode: e.target.value as 'realtime' | 'batch' }))}
          style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        >
          <option value="realtime">实时同步</option>
          <option value="batch">定时批量同步</option>
        </select>
      </div>

      {/* Batch Interval */}
      {config.syncMode === 'batch' && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
            同步间隔（分钟）
          </label>
          <input
            type="number"
            min={5}
            max={1440}
            value={config.batchInterval}
            onChange={(e) => setConfig((c) => ({ ...c, batchInterval: parseInt(e.target.value) || 5 }))}
            style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
      )}

      {/* Platform Toggles */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
          启用平台
        </label>
        {Object.values(Platform).map((platform) => (
          <label
            key={platform}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={config.enabledPlatforms.includes(platform)}
              onChange={() => togglePlatform(platform)}
            />
            <span style={{ fontSize: '14px' }}>{platformLabels[platform]}</span>
          </label>
        ))}
      </div>

      {/* Save Button */}
      <button
        onClick={saveConfig}
        disabled={saving}
        style={{
          width: '100%',
          padding: '10px',
          fontSize: '14px',
          fontWeight: 500,
          border: 'none',
          borderRadius: '6px',
          backgroundColor: '#2563eb',
          color: 'white',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? '保存中...' : '保存配置'}
      </button>
    </div>
  )
}

export default App
