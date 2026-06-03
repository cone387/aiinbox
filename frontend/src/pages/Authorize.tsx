import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Spin, Result } from 'antd'
import { SafetyOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import client from '../api/client'

export default function Authorize() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [authorizing, setAuthorizing] = useState(false)
  const [error, setError] = useState('')
  const [validated, setValidated] = useState<{ redirect_uri: string; state: string; app_name: string } | null>(null)

  // Parse query params
  const params = new URLSearchParams(window.location.search)
  const rawRedirectUri = params.get('redirect_uri') || ''
  const rawState = params.get('state') || ''
  const rawAppName = params.get('app_name') || 'AI Inbox 浏览器插件'

  useEffect(() => {
    if (!isAuthenticated) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search)
      navigate('/login?return=' + returnUrl)
      return
    }
    // Server-side validation of redirect_uri before any UI is rendered.
    if (!rawRedirectUri) {
      setError('缺少 redirect_uri 参数')
      return
    }
    client.get('/authorize/validate', {
      params: { redirect_uri: rawRedirectUri, state: rawState, app_name: rawAppName },
    }).then((resp) => {
      setValidated(resp.data)
    }).catch((err) => {
      const msg = err?.response?.data?.message || 'redirect_uri 无效'
      setError(msg)
    })
  }, [isAuthenticated, rawRedirectUri, rawState, rawAppName])

  async function handleAuthorize() {
    if (!validated) return

    setAuthorizing(true)
    try {
      const resp = await client.post('/authorize', {
        redirect_uri: validated.redirect_uri,
        state: validated.state,
        app_name: validated.app_name,
      })
      const code = resp.data.code
      const sep = validated.redirect_uri.includes('?') ? '&' : '?'
      window.location.href = `${validated.redirect_uri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(validated.state)}`
    } catch {
      setError('授权失败，请重试')
      setAuthorizing(false)
    }
  }

  function handleDeny() {
    if (validated?.redirect_uri) {
      const sep = validated.redirect_uri.includes('?') ? '&' : '?'
      window.location.href = `${validated.redirect_uri}${sep}error=access_denied&state=${encodeURIComponent(validated.state)}`
    } else {
      window.close()
    }
  }

  if (!isAuthenticated || (!validated && !error)) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Spin size="large" /></div>
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
        <Result status="error" title="授权失败" subTitle={error} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Card style={{ width: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <SafetyOutlined style={{ fontSize: '48px', color: '#1677ff' }} />
          <h2 style={{ marginTop: '16px', marginBottom: '8px' }}>授权请求</h2>
          <p style={{ color: '#666', margin: 0 }}>
            <strong>{validated!.app_name}</strong> 请求访问你的 AI Inbox 账户
          </p>
        </div>

        <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <p style={{ margin: '0 0 8px', fontWeight: 500, fontSize: '13px' }}>授权后，插件将能够：</p>
          <ul style={{ margin: 0, paddingLeft: '20px', color: '#666', fontSize: '13px' }}>
            <li>上传收集到的 AI 对话记录</li>
            <li>查询和同步对话数据</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <Button block onClick={handleDeny} disabled={authorizing}>
            拒绝
          </Button>
          <Button type="primary" block onClick={handleAuthorize} loading={authorizing}>
            授权
          </Button>
        </div>
      </Card>
    </div>
  )
}
