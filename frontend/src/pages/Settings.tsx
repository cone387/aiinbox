import { useState } from 'react'
import { Card, Form, Input, Button, message, Modal, Typography } from 'antd'
import { CopyOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { generateAPIToken } from '../api/auth'
import { batchDelete } from '../api/conversations'
import { useAuthStore } from '../stores/authStore'

const { Paragraph } = Typography

export default function Settings() {
  const [apiToken, setApiToken] = useState<string | null>(null)
  const [tokenExpires, setTokenExpires] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const logout = useAuthStore((s) => s.logout)

  async function handleGenerateToken() {
    Modal.confirm({
      title: '重新生成 API Token',
      icon: <ExclamationCircleOutlined />,
      content: '旧的 API Token 将立即失效，插件需要重新配置新 Token。确定继续？',
      onOk: async () => {
        setGenerating(true)
        try {
          const data = await generateAPIToken()
          setApiToken(data.api_token)
          setTokenExpires(data.expires_at)
          message.success('Token 已生成')
        } catch {
          message.error('生成失败')
        }
        setGenerating(false)
      },
    })
  }

  function copyToken() {
    if (apiToken) {
      navigator.clipboard.writeText(apiToken)
      message.success('已复制到剪贴板')
    }
  }

  async function handleDeleteAll() {
    Modal.confirm({
      title: '删除所有数据',
      icon: <ExclamationCircleOutlined />,
      content: '此操作将删除所有对话数据，且不可恢复。确定继续？',
      okType: 'danger',
      onOk: async () => {
        // This would need a dedicated endpoint; for now show message
        message.info('请使用 API 进行批量删除操作')
      },
    })
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '16px' }}>设置</h2>

      {/* API Token */}
      <Card title="API Token" style={{ marginBottom: '16px' }}>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '12px' }}>
          API Token 用于浏览器插件连接此服务。生成后请复制到插件设置中。
        </p>

        {apiToken ? (
          <div style={{ marginBottom: '12px' }}>
            <Paragraph
              copyable={{ icon: <CopyOutlined />, onCopy: copyToken }}
              style={{ fontFamily: 'monospace', backgroundColor: '#f5f5f5', padding: '8px', borderRadius: '4px' }}
            >
              {apiToken}
            </Paragraph>
            <p style={{ fontSize: '12px', color: '#999' }}>
              过期时间: {tokenExpires ? new Date(tokenExpires).toLocaleDateString() : '-'}
            </p>
          </div>
        ) : (
          <p style={{ color: '#999', fontSize: '13px', marginBottom: '12px' }}>
            尚未生成 Token，点击下方按钮生成。
          </p>
        )}

        <Button type="primary" onClick={handleGenerateToken} loading={generating}>
          {apiToken ? '重新生成' : '生成 API Token'}
        </Button>
      </Card>

      {/* Change Password */}
      <Card title="修改密码" style={{ marginBottom: '16px' }}>
        <Form layout="vertical" onFinish={() => message.info('密码修改功能开发中')}>
          <Form.Item label="当前密码" name="current_password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="新密码" name="new_password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">修改密码</Button>
        </Form>
      </Card>

      {/* Danger Zone */}
      <Card title="危险操作" style={{ borderColor: '#ff4d4f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 500 }}>删除所有数据</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>删除所有对话记录，不可恢复</p>
          </div>
          <Button danger onClick={handleDeleteAll}>删除</Button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 500 }}>退出登录</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>清除本地登录状态</p>
          </div>
          <Button onClick={logout}>退出</Button>
        </div>
      </Card>
    </div>
  )
}
