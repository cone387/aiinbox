import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout as AntLayout, Menu } from 'antd'
import {
  MessageOutlined,
  SearchOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

const { Sider, Content } = AntLayout

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((s) => s.logout)

  const menuItems = [
    { key: '/', icon: <MessageOutlined />, label: '对话' },
    { key: '/search', icon: <SearchOutlined />, label: '搜索' },
    { key: '/stats', icon: <BarChartOutlined />, label: '统计' },
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
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px', fontWeight: 600, fontSize: '16px', textAlign: 'center' }}>
          AI Inbox
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Content style={{ padding: '24px', backgroundColor: '#f5f5f5' }}>
        <Outlet />
      </Content>
    </AntLayout>
  )
}
