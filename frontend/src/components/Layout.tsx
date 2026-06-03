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

// Simple SVG platform icons
function ChatGPTIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="#10a37f" fillOpacity="0.15" stroke="#10a37f" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="#10a37f" fontWeight="700">C</text>
    </svg>
  )
}

function GeminiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="#4285f4" fillOpacity="0.15" stroke="#4285f4" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="#4285f4" fontWeight="700">G</text>
    </svg>
  )
}

function TongyiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="#722ed1" fillOpacity="0.15" stroke="#722ed1" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="#722ed1" fontWeight="700">Q</text>
    </svg>
  )
}

function DoubaoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="#fa541c" fillOpacity="0.15" stroke="#fa541c" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fill="#fa541c" fontWeight="700">D</text>
    </svg>
  )
}

function PlatformIcon({ platform, size }: { platform: string; size?: number }) {
  switch (platform) {
    case 'chatgpt': return <ChatGPTIcon size={size} />
    case 'gemini': return <GeminiIcon size={size} />
    case 'tongyi': return <TongyiIcon size={size} />
    case 'doubao': return <DoubaoIcon size={size} />
    default: return null
  }
}

export const LayoutContext = createContext({
  searchKeyword: '',
  setSearchKeyword: (_: string) => {},
})

export function useLayout() {
  return useContext(LayoutContext)
}

export function usePlatformIcon() {
  return PlatformIcon
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((s) => s.logout)
  const [searchKeyword, setSearchKeyword] = useState('')

  const navItems = [
    { key: '/stats', icon: <BarChartOutlined />, label: '统计' },
    { key: '/tokens', icon: <KeyOutlined />, label: 'API Tokens' },
    { key: '/settings', icon: <SettingOutlined />, label: '设置' },
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
          {/* Left: brand + search + 对话 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a1a', marginRight: 8 }}>
              AI Inbox
            </div>

            <Input
              prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 13 }} />}
              placeholder="搜索对话内容..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
              style={{
                width: 200,
                borderRadius: 6,
                border: '1px solid #e0e0e0',
              }}
              size="small"
            />

            <div
              onClick={() => navigate('/')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                color: selectedKey === '/' ? '#1677ff' : '#666',
                backgroundColor: selectedKey === '/' ? 'rgba(22,119,255,0.08)' : 'transparent',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <MessageOutlined />
              <span>对话</span>
            </div>
          </div>

          {/* Right: nav items + logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {navItems.map(item => (
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
                  color: selectedKey === item.key ? '#1677ff' : '#666',
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

            <div
              onClick={() => handleMenuClick('logout')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                color: '#ff4d4f',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <LogoutOutlined />
              <span>退出</span>
            </div>
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
