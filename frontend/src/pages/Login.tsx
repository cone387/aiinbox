import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Card, Form, Input, Button, Spin } from 'antd'
import { useAuthStore } from '../stores/authStore'
import { getAuthStatus } from '../api/auth'

export default function Login() {
  const navigate = useNavigate()
  const { login, loading, error } = useAuthStore()
  const [initialized, setInitialized] = useState<boolean | null>(null)

  useEffect(() => {
    getAuthStatus().then((status) => {
      setInitialized(status.initialized)
      if (!status.initialized) {
        navigate('/setup')
      }
    }).catch(() => {
      // If API fails, assume initialized (safer default)
      setInitialized(true)
    })
  }, [navigate])

  const handleLogin = async (values: { username: string; password: string }) => {
    await login(values.username, values.password)
    if (useAuthStore.getState().isAuthenticated) {
      const params = new URLSearchParams(window.location.search)
      const returnUrl = params.get('return')
      navigate(returnUrl ? decodeURIComponent(returnUrl) : '/')
    }
  }

  if (initialized === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>AI Inbox</h2>
        <Form onFinish={handleLogin} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password />
          </Form.Item>
          {error && <p style={{ color: '#ff4d4f', marginBottom: '16px' }}>{error}</p>}
          <Button type="primary" htmlType="submit" loading={loading} block>
            登录
          </Button>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Link to="/reset-password" style={{ fontSize: 13 }}>忘记密码？</Link>
          </div>
        </Form>
      </Card>
    </div>
  )
}
