import { useEffect, useState } from 'react'
import { Card, Button, Input, Table, Modal, message, Tag, Space, Typography } from 'antd'
import { PlusOutlined, DeleteOutlined, CopyOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { listTokens, createToken, deleteToken, APITokenView, APITokenFull } from '../api/tokens'

const { Paragraph } = Typography

export default function Tokens() {
  const [tokens, setTokens] = useState<APITokenView[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newlyCreated, setNewlyCreated] = useState<APITokenFull | null>(null)

  useEffect(() => {
    fetchTokens()
  }, [])

  async function fetchTokens() {
    setLoading(true)
    try {
      const data = await listTokens()
      setTokens(data)
    } catch {
      message.error('加载令牌失败')
    }
    setLoading(false)
  }

  async function handleCreate() {
    if (!newTokenName.trim()) {
      message.warning('请输入令牌名称')
      return
    }
    setCreating(true)
    try {
      const token = await createToken(newTokenName.trim())
      setNewlyCreated(token)
      setShowCreateModal(false)
      setNewTokenName('')
      fetchTokens()
      message.success('令牌创建成功')
    } catch {
      message.error('创建令牌失败')
    }
    setCreating(false)
  }

  function handleDelete(id: number, name: string) {
    Modal.confirm({
      title: '删除令牌',
      icon: <ExclamationCircleOutlined />,
      content: `确定删除"${name}"吗？此操作不可撤销，使用该令牌的服务将停止工作。`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteToken(id)
          fetchTokens()
          message.success('令牌已删除')
        } catch {
          message.error('删除令牌失败')
        }
      },
    })
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token)
    message.success('已复制到剪贴板')
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: '令牌',
      dataIndex: 'token',
      key: 'token',
      render: (token: string) => (
        <code style={{ fontSize: '12px', backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
          {token}
        </code>
      ),
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (date: string) => {
        const isExpired = new Date(date) < new Date()
        return <Tag color={isExpired ? 'red' : 'green'}>{date}</Tag>
      },
    },
    {
      title: '最后使用',
      dataIndex: 'last_used',
      key: 'last_used',
      render: (date: string) => date || <span style={{ color: '#999' }}>从未使用</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: APITokenView) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(record.id, record.name)}
        />
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>接入令牌</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
          创建令牌
        </Button>
      </div>

      <p style={{ color: '#666', marginBottom: '16px' }}>
        接入令牌用于浏览器插件与本服务器的身份认证。
        创建时请复制令牌 —— 之后将无法再次查看完整内容。
      </p>

      {/* Newly created token display */}
      {newlyCreated && (
        <Card style={{ marginBottom: '16px', borderColor: '#52c41a' }}>
          <div style={{ marginBottom: '8px' }}>
            <Tag color="success">新令牌已创建</Tag>
            <strong>{newlyCreated.name}</strong>
          </div>
          <p style={{ marginBottom: '8px', color: '#666', fontSize: '12px' }}>
            请立即复制此令牌，之后将无法再次查看。
          </p>
          <Space>
            <Paragraph
              copyable={{ onCopy: () => copyToken(newlyCreated.token) }}
              style={{ margin: 0, fontFamily: 'monospace', fontSize: '13px', backgroundColor: '#f6ffed', padding: '8px 12px', borderRadius: '4px', border: '1px solid #b7eb8f' }}
            >
              {newlyCreated.token}
            </Paragraph>
            <Button icon={<CopyOutlined />} onClick={() => copyToken(newlyCreated.token)}>
              复制
            </Button>
          </Space>
          <div style={{ marginTop: '8px' }}>
            <Button size="small" onClick={() => setNewlyCreated(null)}>关闭</Button>
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        dataSource={tokens}
        rowKey="id"
        loading={loading}
        pagination={false}
        locale={{ emptyText: '暂无令牌。创建一个以连接浏览器插件。' }}
      />

      {/* Create Modal */}
      <Modal
        title="创建接入令牌"
        open={showCreateModal}
        onOk={handleCreate}
        onCancel={() => { setShowCreateModal(false); setNewTokenName('') }}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
      >
        <p style={{ marginBottom: '12px', color: '#666' }}>
          为令牌取个名字以便识别用途（例如"Chrome 插件"、"办公电脑"）。
        </p>
        <Input
          placeholder="令牌名称"
          value={newTokenName}
          onChange={(e) => setNewTokenName(e.target.value)}
          onPressEnter={handleCreate}
          maxLength={128}
        />
      </Modal>
    </div>
  )
}
