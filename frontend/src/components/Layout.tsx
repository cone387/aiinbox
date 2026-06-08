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

// ChatGPT logo from official favicon
function ChatGPTIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 180 180" fill="none" style={{ flexShrink: 0 }}>
      <path d="M101.228 164.247C96.2776 164.247 91.5751 163.307 87.1201 161.426C82.6651 159.545 78.7051 156.921 75.2401 153.555C71.4781 154.842 67.5676 155.486 63.5086 155.486C56.8756 155.486 50.7376 153.852 45.0946 150.585C39.4516 147.318 34.8976 142.863 31.4326 137.22C28.0666 131.577 26.3836 125.291 26.3836 118.361C26.3836 115.49 26.7796 112.371 27.5716 109.005C23.6116 105.342 20.5426 101.135 18.3646 96.3828C16.1866 91.5318 15.0976 86.4828 15.0976 81.2358C15.0976 75.8898 16.2361 70.7418 18.5131 65.7918C20.7901 60.8418 23.9581 56.5848 28.0171 53.0208C32.1751 49.3578 36.9766 46.8333 42.4216 45.4473C43.5106 39.8043 45.7876 34.7553 49.2526 30.3003C52.8166 25.7463 57.1726 22.1823 62.3206 19.6083C67.4686 17.0343 72.9631 15.7473 78.8041 15.7473C83.7541 15.7473 88.4566 16.6878 92.9116 18.5688C97.3666 20.4498 101.327 23.0733 104.792 26.4393C108.554 25.1523 112.464 24.5088 116.523 24.5088C123.156 24.5088 129.294 26.1423 134.937 29.4093C140.58 32.6763 145.085 37.1313 148.451 42.7743C151.916 48.4173 153.648 54.7038 153.648 61.6338C153.648 64.5048 153.252 67.6233 152.46 70.9893C156.42 74.6523 159.489 78.9093 161.667 83.7603C163.845 88.5123 164.934 93.5118 164.934 98.7588C164.934 104.105 163.796 109.253 161.519 114.203C159.242 119.153 156.024 123.459 151.866 127.122C147.807 130.686 143.055 133.161 137.61 134.547C136.521 140.19 134.195 145.239 130.631 149.694C127.166 154.248 122.859 157.812 117.711 160.386C112.563 162.96 107.069 164.247 101.228 164.247ZM64.5481 145.685C69.4981 145.685 73.8046 144.645 77.4676 142.566L105.386 126.528C106.376 125.835 106.871 124.895 106.871 123.707V110.936L70.9336 131.577C68.7556 132.864 66.5776 132.864 64.3996 131.577L36.3331 115.391C36.3331 115.688 36.2836 116.034 36.1846 116.43C36.1846 116.826 36.1846 117.42 36.1846 118.212C36.1846 123.261 37.3726 127.914 39.7486 132.171C42.2236 136.329 45.6391 139.596 49.9951 141.972C54.3511 144.447 59.2021 145.685 64.5481 145.685ZM66.0331 121.479C66.6271 121.776 67.1716 121.925 67.6666 121.925C68.1616 121.925 68.6566 121.776 69.1516 121.479L80.2891 115.094L44.5006 94.3038C42.3226 93.0168 41.2336 91.0863 41.2336 88.5123V56.2878C36.2836 58.4658 32.3236 61.8318 29.3536 66.3858C26.3836 70.8408 24.8986 75.7908 24.8986 81.2358C24.8986 86.0868 26.1361 90.7398 28.6111 95.1948C31.0861 99.6498 34.3036 103.016 38.2636 105.293L66.0331 121.479ZM101.228 154.446C106.475 154.446 111.227 153.258 115.484 150.882C119.741 148.506 123.107 145.239 125.582 141.081C128.057 136.923 129.294 132.27 129.294 127.122V95.0463C129.294 93.8583 128.799 92.9673 127.809 92.3733L116.523 85.8393V127.271C116.523 129.845 115.434 131.775 113.256 133.062L85.1896 149.249C90.0406 152.714 95.3866 154.446 101.228 154.446ZM106.871 100.095V79.8993L90.09 70.3953L73.1611 79.8993V100.095L90.09 109.599L106.871 100.095ZM63.5086 52.7238C63.5086 50.1498 64.5976 48.2193 66.7756 46.9323L94.8421 30.7458C89.9911 27.2808 84.6451 25.5483 78.8041 25.5483C73.5571 25.5483 68.8051 26.7363 64.5481 29.1123C60.2911 31.4883 56.9251 34.7553 54.4501 38.9133C52.0741 43.0713 50.8861 47.7243 50.8861 52.8723V84.7998C50.8861 85.9878 51.3811 86.9283 52.3711 87.6213L63.5086 94.1553V52.7238ZM138.947 123.707C143.897 121.529 147.807 118.163 150.678 113.609C153.648 109.055 155.133 104.105 155.133 98.7588C155.133 93.9078 153.896 89.2548 151.421 84.7998C148.946 80.3448 145.728 76.9788 141.768 74.7018L113.999 58.6638C113.405 58.2678 112.86 58.1193 112.365 58.2183C111.87 58.2183 111.375 58.3668 110.88 58.6638L99.7426 64.9008L135.68 85.8393C136.769 86.4333 137.561 87.2253 138.056 88.2153C138.65 89.1063 138.947 90.1953 138.947 91.4823V123.707ZM109.098 48.2688C111.276 46.8828 113.454 46.8828 115.632 48.2688L143.847 64.7523C143.847 64.0593 143.847 63.1683 143.847 62.0793C143.847 57.3273 142.659 52.8228 140.283 48.5658C138.006 44.2098 134.69 40.7448 130.334 38.1708C126.077 35.5968 121.127 34.3098 115.484 34.3098C110.534 34.3098 106.227 35.3493 102.564 37.4283L74.6461 53.4663C73.6561 54.1593 73.1611 55.0998 73.1611 56.2878V69.0588L109.098 48.2688Z" fill="currentColor" />
    </svg>
  )
}

function GeminiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2L8 7h8l-4-5z" fill="#4285f4" />
      <path d="M22 12l-5-4v8l5-4z" fill="#ea4335" />
      <path d="M12 22l-4-5h8l-4 5z" fill="#34a853" />
      <path d="M2 12l5-4v8l-5-4z" fill="#fbbc04" />
      <rect x="10" y="10" width="4" height="4" fill="#4285f4" />
    </svg>
  )
}

// Tongyi icon from official favicon
function TongyiIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 51 51" fill="none" style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id="g-tongyi-clip"><rect width="51" height="51" rx="10" /></clipPath>
      </defs>
      <g clipPath="url(#g-tongyi-clip)">
        <rect width="51" height="51" rx="10" fill="#fff" />
        <path d="M23.4166,39.5714L26.0038,35.0473L33.5055,21.929L39.1954,21.929C39.1954,21.929,44.1081,30.5232,44.1081,30.5232L38.9338,30.5232L36.3486,25.9991L26.0019,44.0955L23.4147,39.5714L23.4166,39.5714ZM10.48465,16.9508L15.65706,16.9508L18.2423,21.4749L25.7422,34.597L22.8992,39.5752L13.0718,39.5752C13.0718,39.5752,15.65894,35.0473,15.65894,35.0473L20.8314,35.0473C20.8314,35.0473,10.48465,16.9508,10.48465,16.9508ZM15.91483,16.49858L20.8295,7.904448L23.4166,12.42857L20.8295,16.9527L41.5229,16.9527L38.9376,21.4749L18.7616,21.4749L15.91483,16.49858Z" fill="#625CF6" />
      </g>
    </svg>
  )
}

const DOUBAO_AVATAR = 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/doubao_avatar.png'

function DoubaoIcon({ size = 16 }: { size?: number }) {
  return (
    <img src={DOUBAO_AVATAR} alt="豆包" style={{ width: size, height: size, borderRadius: '20%', flexShrink: 0 }} />
  )
}

function DeepSeekIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="512" cy="512" r="512" fill="#4D6BFE" />
      <path d="M690.5 363.5c-39.5-51.5-96.5-87.5-160-101.5-12.5-2.5-25 5.5-27.5 18s5.5 25 18 27.5c107 23.5 184 116.5 184 226 0 9.5-0.5 19-1.5 28.5l-0.5 4.5c-2.5 21.5-10 61-34 101-13.5 22.5-33 46-62.5 63.5-30 18-63 23-94 23-36.5 0-71-10.5-100.5-29.5-29-18.5-52-45.5-65.5-78.5-2.5-6-8.5-9.5-15-9.5h-71.5c-11 0-19 10.5-15.5 21 17.5 51 50.5 95.5 93 127.5 43.5 32.5 97 50 152.5 50 50 0 99.5-17 137-47 38-30 63.5-65.5 80.5-98.5 16.5-32 25-62 29.5-82.5 2.5-11.5 4-22.5 5-31.5 1-9 1.5-19 1.5-28.5C743.5 477.5 727 415 690.5 363.5z" fill="white"/>
      <path d="M475.5 332.5c0-13-10.5-23.5-23.5-23.5-53.5 0-104 22-141.5 60-37.5 38-58 89.5-58 143.5 0 38 12 78 37 112.5 24.5 34 58.5 59.5 97.5 73.5 12 4.5 25.5-2 29.5-14 4.5-12-2-25.5-14-29.5-60-22-103.5-78.5-103.5-142.5 0-83 67-150.5 152.5-150.5h0.5C465 362 475.5 351.5 475.5 332.5z" fill="white"/>
    </svg>
  )
}

function AllIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M237.136842 474.273684C107.789474 474.273684 0 366.484211 0 237.136842S107.789474 0 237.136842 0s237.136842 107.789474 237.136842 237.136842-107.789474 237.136842-237.136842 237.136842z m0-366.48421C167.073684 107.789474 107.789474 167.073684 107.789474 237.136842s59.284211 129.347368 129.347368 129.347369 129.347368-59.284211 129.347369-129.347369S307.2 107.789474 237.136842 107.789474z m549.726316 366.48421c-129.347368 0-237.136842-107.789474-237.136842-237.136842s107.789474-237.136842 237.136842-237.136842C916.210526 0 1024 107.789474 1024 237.136842s-107.789474 237.136842-237.136842 237.136842z m0-366.48421c-70.063158 0-129.347368 59.284211-129.347369 129.347368s59.284211 129.347368 129.347369 129.347369S916.210526 307.2 916.210526 237.136842 856.926316 107.789474 786.863158 107.789474z m0 916.210526c-129.347368 0-237.136842-107.789474-237.136842-237.136842 0-129.347368 107.789474-237.136842 237.136842-237.136842 129.347368 0 237.136842 107.789474 237.136842 237.136842 0 129.347368-107.789474 237.136842-237.136842 237.136842z m0-366.484211c-70.063158 0-129.347368 59.284211-129.347369 129.347369s59.284211 129.347368 129.347369 129.347368 129.347368-59.284211 129.347368-129.347368-59.284211-129.347368-129.347368-129.347369zM237.136842 1024C107.789474 1024 0 916.210526 0 786.863158c0-129.347368 107.789474-237.136842 237.136842-237.136842s237.136842 107.789474 237.136842 237.136842c0 129.347368-107.789474 237.136842-237.136842 237.136842z m0-366.484211c-70.063158 0-129.347368 59.284211-129.347368 129.347369S167.073684 916.210526 237.136842 916.210526s129.347368-59.284211 129.347369-129.347368-59.284211-129.347368-129.347369-129.347369z" />
    </svg>
  )
}

function PlatformIcon({ platform, size }: { platform: string; size?: number }) {
  switch (platform) {
    case 'chatgpt': return <ChatGPTIcon size={size} />
    case 'gemini': return <GeminiIcon size={size} />
    case 'tongyi': return <TongyiIcon size={size} />
    case 'doubao': return <DoubaoIcon size={size} />
    case 'deepseek': return <DeepSeekIcon size={size} />
    default: return <AllIcon size={size} />
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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#fff', overflow: 'hidden' }}>
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
