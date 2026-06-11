import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message, Result, Steps } from 'antd'
import { CheckCircleOutlined, UserOutlined, SafetyOutlined, RocketOutlined } from '@ant-design/icons'
import { register, login } from '../api/auth'

export default function Setup() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [credentials, setCredentials] = useState({ username: '', password: '' })

  const handleCreateAccount = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      await register(values.username, values.password)
      setCredentials({ username: values.username, password: values.password })
      setCurrent(1)
    } catch (err: any) {
      const msg = err?.response?.data?.message || '创建账户失败'
      message.error(msg)
    }
    setLoading(false)
  }

  const handleLogin = async () => {
    setLoading(true)
    try {
      await login(credentials.username, credentials.password)
      message.success('初始化完成，欢迎使用 AI Inbox！')
      navigate('/')
    } catch {
      message.error('自动登录失败，请手动登录')
      navigate('/login')
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Card style={{ width: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>欢迎使用 AI Inbox</h2>
          <p style={{ color: '#666' }}>首次运行，请创建管理员账户</p>
        </div>

        <Steps
          current={current}
          size="small"
          style={{ marginBottom: '32px' }}
          items={[
            { title: '创建账户', icon: <UserOutlined /> },
            { title: '完成', icon: <CheckCircleOutlined /> },
          ]}
        />

        {current === 0 && (
          <Form onFinish={handleCreateAccount} layout="vertical">
            <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, message: '用户名至少3个字符' }]}>
              <Input prefix={<UserOutlined />} size="large" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少6个字符' }]}>
              <Input.Password prefix={<SafetyOutlined />} size="large" />
            </Form.Item>
            <Form.Item name="confirmPassword" label="确认密码" dependencies={['password']} rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}>
              <Input.Password prefix={<SafetyOutlined />} size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              创建账户并开始使用
            </Button>
          </Form>
        )}

        {current === 1 && (
          <Result
            status="success"
            title="账户创建成功！"
            subTitle="点击下方按钮自动登录并开始使用 AI Inbox"
            extra={[
              <Button type="primary" size="large" icon={<RocketOutlined />} onClick={handleLogin} loading={loading}>
                开始使用
              </Button>,
            ]}
          />
        )}
      </Card>
    </div>
  )
}
