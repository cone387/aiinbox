import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <h1 className="text-2xl font-bold text-center py-8">AI Chat Collector</h1>
        <p className="text-center text-gray-500">Frontend coming soon...</p>
      </div>
    </ConfigProvider>
  )
}

export default App
