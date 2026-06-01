import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message, Tabs } from 'antd'
import { useAuthStore } from '../stores/authStore'

export default function Login() {
  const navigate = useNavigate()
  const { login, register, loading, error } = useAuthStore()
  const [activeTab, setActiveTab] = useState('login')

  const handleLogin = async (values: { username: string; password: string }) => {
    await login(values.username, values.password)
    if (useAuthStore.getState().isAuthenticated) {
      const params = new URLSearchParams(window.location.search)
      const returnUrl = params.get('return')
      navigate(returnUrl ? decodeURIComponent(returnUrl) : '/')
    }
  }

  const handleRegister = async (values: { username: string; password: string }) => {
    await register(values.username, values.password)
    if (!useAuthStore.getState().error) {
      message.success('注册成功，请登录')
      setActiveTab('login')
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>AI Chat Collector</h2>
        <Tabs activeKey={activeTab} onChange={setActiveTab} centered items={[
          {
            key: 'login',
            label: '登录',
            children: (
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
              </Form>
            ),
          },
          {
            key: 'register',
            label: '注册',
            children: (
              <Form onFinish={handleRegister} layout="vertical">
                <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, message: '用户名至少3个字符' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少6个字符' }]}>
                  <Input.Password />
                </Form.Item>
                {error && <p style={{ color: '#ff4d4f', marginBottom: '16px' }}>{error}</p>}
                <Button type="primary" htmlType="submit" loading={loading} block>
                  注册
                </Button>
              </Form>
            ),
          },
        ]} />
      </Card>
    </div>
  )
}
