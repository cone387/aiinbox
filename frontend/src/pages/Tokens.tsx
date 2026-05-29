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
      message.error('Failed to load tokens')
    }
    setLoading(false)
  }

  async function handleCreate() {
    if (!newTokenName.trim()) {
      message.warning('Please enter a token name')
      return
    }
    setCreating(true)
    try {
      const token = await createToken(newTokenName.trim())
      setNewlyCreated(token)
      setShowCreateModal(false)
      setNewTokenName('')
      fetchTokens()
      message.success('Token created')
    } catch {
      message.error('Failed to create token')
    }
    setCreating(false)
  }

  function handleDelete(id: number, name: string) {
    Modal.confirm({
      title: 'Delete Token',
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to delete "${name}"? This cannot be undone and any services using this token will stop working.`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteToken(id)
          fetchTokens()
          message.success('Token deleted')
        } catch {
          message.error('Failed to delete token')
        }
      },
    })
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token)
    message.success('Copied to clipboard')
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: 'Token',
      dataIndex: 'token',
      key: 'token',
      render: (token: string) => (
        <code style={{ fontSize: '12px', backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
          {token}
        </code>
      ),
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (date: string) => {
        const isExpired = new Date(date) < new Date()
        return <Tag color={isExpired ? 'red' : 'green'}>{date}</Tag>
      },
    },
    {
      title: 'Last Used',
      dataIndex: 'last_used',
      key: 'last_used',
      render: (date: string) => date || <span style={{ color: '#999' }}>Never</span>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
    },
    {
      title: 'Actions',
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
        <h2 style={{ margin: 0 }}>API Tokens</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
          Create Token
        </Button>
      </div>

      <p style={{ color: '#666', marginBottom: '16px' }}>
        API Tokens are used by the browser extension to authenticate with this server.
        Copy the token when created - it won't be shown in full again.
      </p>

      {/* Newly created token display */}
      {newlyCreated && (
        <Card style={{ marginBottom: '16px', borderColor: '#52c41a' }}>
          <div style={{ marginBottom: '8px' }}>
            <Tag color="success">New Token Created</Tag>
            <strong>{newlyCreated.name}</strong>
          </div>
          <p style={{ marginBottom: '8px', color: '#666', fontSize: '12px' }}>
            Copy this token now. You won't be able to see it again.
          </p>
          <Space>
            <Paragraph
              copyable={{ onCopy: () => copyToken(newlyCreated.token) }}
              style={{ margin: 0, fontFamily: 'monospace', fontSize: '13px', backgroundColor: '#f6ffed', padding: '8px 12px', borderRadius: '4px', border: '1px solid #b7eb8f' }}
            >
              {newlyCreated.token}
            </Paragraph>
            <Button icon={<CopyOutlined />} onClick={() => copyToken(newlyCreated.token)}>
              Copy
            </Button>
          </Space>
          <div style={{ marginTop: '8px' }}>
            <Button size="small" onClick={() => setNewlyCreated(null)}>Dismiss</Button>
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        dataSource={tokens}
        rowKey="id"
        loading={loading}
        pagination={false}
        locale={{ emptyText: 'No tokens yet. Create one to connect the browser extension.' }}
      />

      {/* Create Modal */}
      <Modal
        title="Create API Token"
        open={showCreateModal}
        onOk={handleCreate}
        onCancel={() => { setShowCreateModal(false); setNewTokenName('') }}
        confirmLoading={creating}
        okText="Create"
      >
        <p style={{ marginBottom: '12px', color: '#666' }}>
          Give your token a name to identify where it's used (e.g. "Chrome Extension", "Work Laptop").
        </p>
        <Input
          placeholder="Token name"
          value={newTokenName}
          onChange={(e) => setNewTokenName(e.target.value)}
          onPressEnter={handleCreate}
          maxLength={128}
        />
      </Modal>
    </div>
  )
}
