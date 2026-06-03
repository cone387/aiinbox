import { createContext, useContext, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout as AntLayout, Menu } from 'antd'
import {
  MessageOutlined,
  BarChartOutlined,
  KeyOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

const { Sider, Content } = AntLayout

export const LayoutContext = createContext({
  sidebarCollapsed: false,
  toggleSidebar: () => {},
})

export function useLayout() {
  return useContext(LayoutContext)
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((s) => s.logout)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
    <LayoutContext.Provider value={{ sidebarCollapsed, toggleSidebar: () => setSidebarCollapsed(s => !s) }}>
      <AntLayout style={{ minHeight: '100vh' }}>
        <Sider
          collapsible
          collapsed={sidebarCollapsed}
          collapsedWidth={56}
          trigger={null}
          theme="light"
          style={{ borderRight: '1px solid #f0f0f0' }}
        >
          <div style={{ padding: '16px', fontWeight: 600, fontSize: '16px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {!sidebarCollapsed && 'AI Inbox'}
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ borderRight: 0 }}
          />
        </Sider>
        <Content style={{ padding: 0, backgroundColor: '#ffffff' }}>
          <Outlet />
        </Content>
      </AntLayout>
    </LayoutContext.Provider>
  )
}
