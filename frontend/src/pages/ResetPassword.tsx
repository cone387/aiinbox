import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Form, Input, Button, message } from 'antd'
import { resetPassword } from '../api/auth'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleReset = async (values: { new_password: string; confirm: string }) => {
    if (values.new_password !== values.confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    setError('')
    try {
      await resetPassword(values.new_password)
      message.success('密码重置成功，请重新登录')
      navigate('/login')
    } catch (err: any) {
      const msg = err?.response?.data?.message || '重置失败，请确认服务运行在本地'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>重置密码</h2>
        <p style={{ textAlign: 'center', marginBottom: '24px', color: '#666', fontSize: 13 }}>
          此功能仅在本地运行时可用
        </p>
        <Form onFinish={handleReset} layout="vertical">
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6位' },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认密码"
            rules={[{ required: true, message: '请再次输入密码' }]}
          >
            <Input.Password />
          </Form.Item>
          {error && <p style={{ color: '#ff4d4f', marginBottom: '16px' }}>{error}</p>}
          <Button type="primary" htmlType="submit" loading={loading} block>
            重置密码
          </Button>
          <Button type="link" onClick={() => navigate('/login')} block style={{ marginTop: 8 }}>
            返回登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
