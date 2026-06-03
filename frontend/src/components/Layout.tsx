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

  const handleMenuClick = (key: string) => {
    if (key === 'logout') {
      logout()
    } else {
      navigate(key)
    }
  }

  const selectedKey = location.pathname === '/' ? '/' : `/${location.pathname.split('/')[1]}`

  return (
    <LayoutContext.Provider value={{ searchKeyword, setSearchKeyword }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#fff' }}>
        {/* Top nav bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 48,
          padding: '0 16px',
          borderBottom: '1px solid #e5e5e5',
          flexShrink: 0,
        }}>
          {/* Left: brand */}
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a1a', marginRight: 32 }}>
            AI Inbox
          </div>

          {/* Right: nav + search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {menuItems.map(item => (
              <div
                key={item.key}
                onClick={() => handleMenuClick(item.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: item.key === 'logout' ? '#ff4d4f' : (selectedKey === item.key ? '#1677ff' : '#666'),
                  backgroundColor: selectedKey === item.key ? 'rgba(22,119,255,0.08)' : 'transparent',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </div>
            ))}

            <div style={{ width: 1, height: 20, backgroundColor: '#e5e5e5', margin: '0 8px' }}></div>

            <Input
              prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 13 }} />}
              placeholder="搜索对话内容..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
              style={{
                width: 220,
                borderRadius: 6,
                border: '1px solid #e0e0e0',
              }}
              size="small"
            />
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Outlet />
        </div>
      </div>
    </LayoutContext.Provider>
  )
}
