import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Spin, Result } from 'antd'
import { SafetyOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { createToken } from '../api/tokens'

export default function Authorize() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [authorizing, setAuthorizing] = useState(false)
  const [error, setError] = useState('')

  // Parse query params
  const params = new URLSearchParams(window.location.search)
  const redirectUri = params.get('redirect_uri') || ''
  const state = params.get('state') || ''
  const extName = params.get('app_name') || 'AI Inbox 浏览器插件'

  useEffect(() => {
    // If not logged in, redirect to login then come back
    if (!isAuthenticated) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search)
      navigate('/login?return=' + returnUrl)
    }
  }, [isAuthenticated])

  async function handleAuthorize() {
    if (!redirectUri) {
      setError('缺少 redirect_uri 参数')
      return
    }

    setAuthorizing(true)
    try {
      // Generate a token named after the extension
      const tokenData = await createToken('浏览器插件授权 ' + new Date().toLocaleDateString())

      // Redirect back to the extension with the token
      const sep = redirectUri.includes('?') ? '&' : '?'
      const callbackUrl = `${redirectUri}${sep}token=${encodeURIComponent(tokenData.token)}&state=${encodeURIComponent(state)}`
      window.location.href = callbackUrl
    } catch (err) {
      setError('授权失败，请重试')
      setAuthorizing(false)
    }
  }

  function handleDeny() {
    if (redirectUri) {
      const sep = redirectUri.includes('?') ? '&' : '?'
      window.location.href = `${redirectUri}${sep}error=access_denied&state=${encodeURIComponent(state)}`
    } else {
      window.close()
    }
  }

  if (!isAuthenticated) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}><Spin size="large" /></div>
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
        <Result status="error" title="授权失败" subTitle={error} extra={<Button onClick={() => setError('')}>重试</Button>} />
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
            <strong>{extName}</strong> 请求访问你的 AI Inbox 账户
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
