# 双栏布局设计文档

## 背景

将现有的独立会话列表页和会话详情页改为 ChatGPT 风格的双栏布局：左侧会话列表，右侧会话内容。

## 路由

- `/` → 双栏布局，默认加载最新会话
- `/conversations/:id` → 双栏布局，定位到指定会话

## 架构

### 文件结构

| 文件 | 变更 |
|------|------|
| `frontend/src/pages/ConversationPanel.tsx` | 新建，双栏主组件 |
| `frontend/src/pages/ConversationPanel.css` | 新建，双栏布局样式 |
| `frontend/src/pages/ConversationList.tsx` | 简化为无分页的紧凑列表，作为子组件 |
| `frontend/src/pages/ConversationList.css` | 新建，列表样式（从 ConversationPanel 拆分） |
| `frontend/src/pages/ConversationDetail.tsx` | 去掉返回按钮和独立布局，作为右侧内容组件 |
| `frontend/src/pages/ConversationDetail.css` | 去掉 max-width/居中，适配右侧栏 |
| `frontend/src/App.tsx` | 路由调整 |
| `frontend/src/components/Layout.tsx` | Content 背景色已改为白，不变 |

### ConversationPanel (主组件)

- 使用 flex 布局，左右分栏
- 左侧固定宽度 ~320px，右侧 `flex: 1`
- 左侧包含筛选区 + 会话列表
- 右侧包含会话详情
- 进入页面时自动加载第一页数据，选中第一条会话
- 使用 `useNavigate` + `useParams` 同步 URL 和选中状态

### ConversationList (子组件)

- 保留筛选区（平台芯片、排序、时间范围）
- 去掉分页，改为无限滚动加载（IntersectionObserver 或简单加载更多按钮）
- 点击会话调用 `onSelect(id)` 回调
- 高亮当前选中项

### ConversationDetail (右侧内容)

- 去掉返回按钮
- 去掉独立的 max-width 容器
- 去掉 header 的 border-bottom（由父组件提供分隔线）
- 保留消息渲染逻辑

### 交互细节

- 筛选条件变化 → 列表刷新，如果当前选中不在结果中，自动选中第一条
- 列表滚动到底部 → 自动加载下一页
- URL 直接访问 `/conversations/123` → 加载该会话，列表定位到对应项

## 数据流

```
ConversationPanel
├── listConversations() → 左侧数据
│   └── 筛选参数变化 → 重新请求 page=1
│   └── 滚动到底部 → 请求 page+1
├── getConversation(id) → 右侧数据
│   └── 选中项变化 → 重新请求
└── URL sync
    └── 选中变化 → navigate(`/conversations/${id}`)
    └── URL 变化 → 更新选中状态
```
