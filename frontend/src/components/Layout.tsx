import { createContext, useContext, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  MessageOutlined,
  BarChartOutlined,
  KeyOutlined,
  SettingOutlined,
  LogoutOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Input } from 'antd'
import { useAuthStore } from '../stores/authStore'

export const LayoutContext = createContext({
  searchKeyword: '',
  setSearchKeyword: (_: string) => {},
})

export function useLayout() {
  return useContext(LayoutContext)
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((s) => s.logout)
  const [searchKeyword, setSearchKeyword] = useState('')

  const menuItems = [
    { key: '/', icon: <MessageOutlined />, label: '对话' },
    { key: '/stats', icon: <BarChartOutlined />, label: '统计' },
    { key: '/tokens', icon: <KeyOutlined />, label: 'API Tokens' },
    { key: '/settings', icon: <SettingOutlined />, label: '设置' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出', danger: true },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout()
    } else {
      navigate(key)
    }
  }

  const selectedKey = location.pathname === '/' ? '/' : `/${location.pathname.split('/')[1]}`

  return (
    <LayoutContext.Provider value={{ searchKeyword, setSearchKeyword }}>
      <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#fff' }}>
        {/* Left nav */}
        <div style={{
          width: 56,
          flexShrink: 0,
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 16,
          backgroundColor: '#fafafa',
        }}>
          <div style={{
            marginBottom: 24,
            fontWeight: 600,
            fontSize: 14,
            color: '#1a1a1a',
            writingMode: 'vertical-rl',
            letterSpacing: 2,
          }}>
            AI Inbox
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            {menuItems.map(item => (
              <div
                key={item.key}
                onClick={() => handleMenuClick({ key: item.key })}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  padding: '8px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: item.key === 'logout' ? '#ff4d4f' : (selectedKey === item.key ? '#1677ff' : '#666'),
                  backgroundColor: selectedKey === item.key ? 'rgba(22,119,255,0.08)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Top bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '8px 16px',
            borderBottom: '1px solid #e5e5e5',
            flexShrink: 0,
          }}>
            <Input
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              placeholder="搜索对话内容..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
              style={{
                width: 280,
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                padding: '6px 12px',
              }}
              size="small"
            />
          </div>

          {/* Page content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Outlet />
          </div>
        </div>
      </div>
    </LayoutContext.Provider>
  )
}
