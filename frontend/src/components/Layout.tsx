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

// Platform icons approximating real logos
function ChatGPTIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="6" fill="#10a37f" fillOpacity="0.1" />
      <path d="M16 4C9.37 4 4 9.37 4 16s5.37 12 12 12c1.3 0 2.3-.6 2.8-1.5l.2-.4c.3-.6.5-1.2.5-1.8 0-1.1-.9-2-2-2h-.5c-.5 0-1 .2-1.4.5-.4.3-.9.4-1.4.3-3.5-.7-6.2-3.7-6.2-7.3 0-3.7 2.9-6.7 6.5-7.1.5 0 1 .1 1.5.4.4.2.8.3 1.3.3h.7c1.1 0 2-.9 2-2 0-.7-.2-1.3-.5-1.8L19.8 4.5C19.3 4.6 18.3 4 16 4z" fill="#10a37f" />
    </svg>
  )
}

function GeminiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="6" fill="#4285f4" fillOpacity="0.1" />
      <path d="M16 6l3.5 5L16 14.5 12.5 11 16 6z" fill="#4285f4" />
      <path d="M21.5 11L26 16l-4.5 5-3.5-5L21.5 11z" fill="#ea4335" />
      <path d="M16 17.5L19.5 21 16 26l-3.5-5L16 17.5z" fill="#34a853" />
      <path d="M10.5 11L14 16l-3.5 5L6 16l4.5-5z" fill="#fbbc04" />
    </svg>
  )
}

function TongyiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="6" fill="#722ed1" fillOpacity="0.1" />
      <circle cx="12" cy="11" r="4.5" fill="none" stroke="#722ed1" strokeWidth="1.8" />
      <path d="M8 22c0-3.3 1.8-5 4-5s4 1.7 4 5" stroke="#722ed1" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M20 8v10M22 10l-4 4M22 10l-4-2" stroke="#722ed1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function DoubaoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="6" fill="#fa541c" fillOpacity="0.1" />
      <path d="M16 7c-5 0-9 3.5-9 8.5 0 3.5 2 6.5 5 7.8V27c0 .6.4 1 1 1h3c.6 0 1-.4 1-1v-2c3-1.3 5-4.3 5-7.8C22 10.5 18 7 16 7z" fill="#fa541c" />
      <circle cx="13.5" cy="15" r="1.2" fill="#fff" />
      <circle cx="18.5" cy="15" r="1.2" fill="#fff" />
      <path d="M14.5 17.5c.5.8 1.5 1.3 1.5 1.3s1-.5 1.5-1.3" stroke="#fff" strokeWidth="1" strokeLinecap="round" fill="none" />
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

  // Derive activeNav purely from React Router's location — no state, no stale sync
  const activeNav = (() => {
    const p = location.pathname
    return p === '/' || p.startsWith('/conversations') ? '/' : `/${p.split('/')[1]}`
  })()

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
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a1a' }}>
            AI Inbox
          </div>

          {/* Right: search + nav items + logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              onClick={() => handleMenuClick('/')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                color: activeNav === '/' ? '#1677ff' : '#666',
                backgroundColor: activeNav === '/' ? 'rgba(22,119,255,0.08)' : 'transparent',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <MessageOutlined />
              <span>对话</span>
            </div>

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
                  color: activeNav === item.key ? '#1677ff' : '#666',
                  backgroundColor: activeNav === item.key ? 'rgba(22,119,255,0.08)' : 'transparent',
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
