# Requirements Document

## Introduction

AI 对话收集器（AI Chat Collector）是一个完整的对话数据管理系统，由三个模块组成：浏览器扩展插件、后端服务和前端 Web 应用。插件通过拦截网络请求的方式，统一收集用户在多个 AI 平台 Web 端的对话记录；后端服务负责接收、存储和提供数据查询 API；前端 Web 应用提供对话浏览、搜索和管理界面。支持的平台包括 ChatGPT、Gemini、通义千问和豆包。采用网络请求拦截方式而非 DOM 解析，以降低因平台 UI 变更带来的维护成本。

## Glossary

- **Extension**：浏览器扩展插件，负责数据采集和推送
- **Backend**：后端服务，负责数据接收、存储和 API 提供
- **Frontend**：前端 Web 应用，负责数据展示、搜索和管理
- **Interceptor**：网络请求拦截模块，负责捕获 AI 平台的 API 请求和响应
- **Parser**：数据解析模块，负责将拦截到的原始网络数据解析为统一的对话数据结构
- **Collector**：数据收集模块，负责汇总和管理解析后的对话数据
- **Sync_Service**：数据同步服务模块，负责将收集到的对话数据发送到后端服务
- **Platform_Adapter**：平台适配器，针对特定 AI 平台的请求/响应格式进行适配
- **Conversation**：一次完整的对话，包含多轮问答
- **Message**：对话中的单条消息，包含角色（用户/AI）、内容和时间戳
- **Unified_Format**：统一对话数据格式，所有平台的对话数据都将转换为此格式存储
- **API_Gateway**：后端 API 网关，处理认证、限流和路由
- **Search_Engine**：搜索引擎模块，提供对话内容的全文搜索能力

## Requirements

### 需求 1：网络请求拦截

**用户故事：** 作为用户，我希望插件能自动拦截 AI 平台的网络请求，以便无感知地收集对话数据。

#### 验收标准

1. WHEN 用户在支持的 AI 平台页面上发起对话, THE Interceptor SHALL 通过浏览器 webRequest API 捕获对应的 API 请求和响应数据，且不阻塞、不修改、不延迟原始请求和响应的正常传递
2. THE Interceptor SHALL 支持拦截以下平台的对话 API 请求：ChatGPT、Gemini、通义千问、豆包
3. WHILE 用户未启用插件的拦截功能, THE Interceptor SHALL 不注册任何 webRequest 监听器，不对任何网络请求进行拦截或修改
4. THE Interceptor SHALL 仅监听各平台用于发送用户消息和接收 AI 回复的对话 API 端点，不拦截平台的登录、资源加载、分析统计等无关请求
5. IF 网络请求拦截失败（包括 webRequest API 不可用、监听器注册异常、或响应数据读取超时超过 30 秒）, THEN THE Extension SHALL 在 3 秒内在插件图标上显示错误状态，并在控制台记录包含失败平台名称、端点 URL 和错误原因的错误信息
6. WHEN 用户同时在多个标签页使用不同的支持平台, THE Interceptor SHALL 独立捕获每个标签页的对话请求，各标签页的拦截互不影响
7. IF 用户在拦截功能启用期间导航离开支持的 AI 平台页面, THEN THE Interceptor SHALL 停止对该标签页的请求监听，并释放相关资源

### 需求 2：流式响应处理

**用户故事：** 作为用户，我希望插件能正确处理 AI 平台的流式响应（SSE/Streaming），以便完整收集 AI 的回复内容。

#### 验收标准

1. WHEN AI 平台返回流式响应（Server-Sent Events）, THE Interceptor SHALL 持续接收并按接收顺序拼接所有数据块，直到收到流结束信号（SSE 格式中的 `[DONE]` 标记或服务端主动关闭连接）
2. WHEN 流式响应正常结束（收到流结束信号）, THE Parser SHALL 在 3 秒内将完整的响应数据解析为 Message 对象
3. IF 流式响应在 30 秒内未收到新的数据块且未收到流结束信号, THEN THE Interceptor SHALL 判定为流中断，保存已接收的部分数据，并标记该 Message 为不完整状态
4. THE Interceptor SHALL 支持 ChatGPT 和 Gemini 使用的 SSE 格式以及通义千问和豆包使用的流式格式
5. WHEN 用户在同一平台同时发起多个对话请求, THE Interceptor SHALL 为每个流式响应维护独立的数据缓冲区，确保不同对话的数据块不会混淆
6. IF 单条流式响应的累计数据量超过 50 MB, THEN THE Interceptor SHALL 停止接收该流的后续数据块，保存已接收的数据，并标记该 Message 为不完整状态

### 需求 3：多平台数据解析

**用户故事：** 作为用户，我希望不同 AI 平台的对话数据能被解析为统一格式，以便后续统一存储和查询。

#### 验收标准

1. THE Parser SHALL 将各平台的原始响应数据解析为 Unified_Format 结构
2. THE Unified_Format SHALL 包含以下字段：平台来源（枚举值：ChatGPT、Gemini、通义千问、豆包）、对话 ID（字符串，最大 256 字符）、消息列表、每条消息的角色（枚举值：user、assistant、system）、内容（字符串）、时间戳（ISO 8601 格式）
3. WHEN ChatGPT 的 API 响应被拦截, THE Platform_Adapter SHALL 从响应中提取对话 ID、消息角色、消息内容和时间戳，并将平台特定的角色名称映射为 Unified_Format 定义的角色枚举值
4. WHEN Gemini 的 API 响应被拦截, THE Platform_Adapter SHALL 从响应中提取对话 ID、消息角色、消息内容和时间戳，并将平台特定的角色名称映射为 Unified_Format 定义的角色枚举值
5. WHEN 通义千问的 API 响应被拦截, THE Platform_Adapter SHALL 从响应中提取对话 ID、消息角色、消息内容和时间戳，并将平台特定的角色名称映射为 Unified_Format 定义的角色枚举值
6. WHEN 豆包的 API 响应被拦截, THE Platform_Adapter SHALL 从响应中提取对话 ID、消息角色、消息内容和时间戳，并将平台特定的角色名称映射为 Unified_Format 定义的角色枚举值
7. IF 响应数据格式无法识别, THEN THE Parser SHALL 保存不超过 1MB 的原始数据并标记为解析失败，不丢弃数据
8. IF 响应中缺少时间戳字段, THEN THE Platform_Adapter SHALL 使用数据拦截时的本地时间作为该消息的时间戳
9. IF 响应中缺少对话 ID 字段, THEN THE Platform_Adapter SHALL 基于平台来源和拦截时间生成唯一标识作为对话 ID
10. IF 响应中包含无法映射的未知角色名称, THEN THE Platform_Adapter SHALL 将该角色映射为 "unknown" 并在解析结果中标记警告

### 需求 4：数据本地缓存

**用户故事：** 作为用户，我希望对话数据先缓存在本地，以便在网络不可用时不丢失数据。

#### 验收标准

1. WHEN 新的对话数据被解析完成, THE Collector SHALL 将数据存储到浏览器本地存储（IndexedDB）中，并将该条数据的同步状态初始化为"未同步"
2. THE Collector SHALL 为每条缓存的对话数据标记同步状态：未同步、同步中、已同步、同步失败
3. IF 本地存储已用空间超过浏览器分配配额的 80%, THEN THE Collector SHALL 通过浏览器通知告知用户存储空间不足，并在插件弹出面板中提供清理已同步历史数据的操作入口
4. THE Collector SHALL 支持按平台、时间范围查询本地缓存的对话数据，查询结果按消息时间戳降序排列，单次查询返回结果不超过 100 条
5. IF 相同对话 ID 的数据已存在于本地缓存中, THEN THE Collector SHALL 将新数据与已有数据合并，保留时间戳较新的消息内容，不产生重复记录
6. IF IndexedDB 写入操作失败, THEN THE Collector SHALL 在 5 秒后自动重试，最多重试 3 次；若仍失败，则将该条数据暂存于内存中，并在插件图标上显示错误状态

### 需求 5：数据同步到远程服务

**用户故事：** 作为用户，我希望收集到的对话数据能自动同步到我自己的服务数据库中，以便集中管理和使用。

#### 验收标准

1. WHEN 用户配置了远程服务地址和认证信息且存在未同步的对话数据, THE Sync_Service SHALL 根据用户选择的同步模式（实时或定时批量）将未同步的对话数据通过 HTTPS 协议发送到远程服务
2. WHILE 同步模式设置为实时同步, WHEN 新的对话数据被解析完成, THE Sync_Service SHALL 在 30 秒内发起同步请求
3. WHILE 同步模式设置为定时批量同步, THE Sync_Service SHALL 按用户配置的时间间隔（可选范围：5 分钟至 24 小时）批量发送未同步数据，每批次最多包含 50 条对话记录
4. IF 远程服务不可达或请求超时（超过 30 秒未响应）, THEN THE Sync_Service SHALL 将同步任务标记为同步失败，并按指数退避策略（初始间隔 1 分钟，最大间隔 30 分钟）自动重试，最多重试 5 次
5. IF 远程服务返回认证失败响应, THEN THE Sync_Service SHALL 停止当前同步任务，将同步状态标记为同步失败，并在插件弹出面板中显示认证错误提示
6. IF 重试次数达到上限仍未成功, THEN THE Sync_Service SHALL 停止该批次的重试，将对应数据保持为同步失败状态，并在插件弹出面板中通知用户同步失败
7. IF 同步过程中发生冲突（相同对话 ID 已存在）, THEN THE Sync_Service SHALL 采用时间戳较新的数据覆盖旧数据
8. WHEN 同步成功完成, THE Sync_Service SHALL 更新本地缓存中对应数据的同步状态为已同步

### 需求 6：用户配置管理

**用户故事：** 作为用户，我希望能配置远程服务地址和选择需要收集的平台，以便灵活控制插件行为。

#### 验收标准

1. THE Extension SHALL 提供设置页面，允许用户配置远程服务的 URL（最大长度 2048 字符）和认证令牌（最大长度 512 字符）
2. THE Extension SHALL 允许用户选择启用或禁用对特定平台（ChatGPT、Gemini、通义千问、豆包）的对话收集，默认状态为全部启用
3. WHEN 用户修改配置并保存后, THE Extension SHALL 在 3 秒内应用新配置，无需重启浏览器
4. THE Extension SHALL 对用户输入的远程服务 URL 进行格式验证，验证规则包括：必须以 https:// 开头、符合标准 URL 格式、不包含空格
5. IF 用户输入的远程服务 URL 格式验证失败, THEN THE Extension SHALL 在输入框附近显示错误提示信息指明验证失败原因，并阻止保存该配置
6. THE Extension SHALL 将认证令牌加密存储在本地，不以明文形式保存
7. IF 用户保存配置时远程服务 URL 或认证令牌为空, THEN THE Extension SHALL 显示错误提示信息指明必填字段不能为空，并阻止保存
8. WHEN 用户禁用某平台的对话收集, THE Extension SHALL 停止对该平台的网络请求拦截，已缓存的该平台历史数据保持不变

### 需求 7：插件状态展示

**用户故事：** 作为用户，我希望能直观了解插件的工作状态和数据收集情况，以便确认插件正常运行。

#### 验收标准

1. THE Extension SHALL 在浏览器工具栏图标上通过颜色或徽标指示当前工作状态：正常运行（绿色）、暂停（灰色）、错误（红色），状态变更后 2 秒内更新图标显示
2. WHEN 用户点击插件图标, THE Extension SHALL 显示弹出面板，展示最近 10 条已收集的对话摘要，每条摘要包含：平台来源、对话 ID、收集时间、同步状态
3. THE Extension SHALL 在弹出面板中显示各平台的收集统计：已收集对话数、待同步数量
4. WHEN 用户点击弹出面板中的暂停开关, THE Extension SHALL 暂停所有平台的数据收集，并将工具栏图标状态更新为暂停状态
5. WHEN 用户点击弹出面板中的恢复开关, THE Extension SHALL 恢复所有平台的数据收集，并将工具栏图标状态更新为正常运行状态
6. IF Interceptor 发生拦截错误或 Sync_Service 发生同步失败, THEN THE Extension SHALL 将工具栏图标状态更新为错误状态，并在弹出面板中显示错误原因描述
7. IF 本地无任何已收集的对话数据, THEN THE Extension SHALL 在弹出面板中显示空状态提示，引导用户访问支持的 AI 平台开始对话

### 需求 8：后端数据接收 API

**用户故事：** 作为插件用户，我希望后端能可靠地接收插件推送的对话数据，以便数据被安全持久化存储。

#### 验收标准

1. THE Backend SHALL 提供 `POST /api/v1/conversations/sync` 端点，接收插件推送的单条对话数据
2. THE Backend SHALL 提供 `POST /api/v1/conversations/batch` 端点，接收插件批量推送的对话数据，单次请求最多接受 50 条对话记录
3. WHEN 接收到对话数据, THE Backend SHALL 验证数据格式是否符合 Unified_Format 规范，包括必填字段检查和字段类型验证
4. IF 数据格式验证失败, THEN THE Backend SHALL 返回 HTTP 400 响应，包含具体的验证错误信息
5. IF 相同对话 ID 的数据已存在于数据库中, THEN THE Backend SHALL 比较时间戳，保留较新的数据版本并更新记录
6. WHEN 数据成功存储, THE Backend SHALL 返回 HTTP 200 响应，包含已存储的对话 ID 列表和处理结果摘要
7. THE Backend SHALL 对单次请求的 body 大小限制为 10MB，超出限制返回 HTTP 413 响应

### 需求 9：后端用户认证

**用户故事：** 作为用户，我希望后端服务有认证机制，以便只有我自己能访问和管理我的对话数据。

#### 验收标准

1. THE Backend SHALL 支持基于 API Token 的认证方式，用户通过 Authorization Header 传递令牌
2. WHEN 请求未携带有效的认证令牌, THE Backend SHALL 返回 HTTP 401 响应，不处理任何数据操作
3. THE Backend SHALL 提供 `POST /api/v1/auth/token` 端点，允许用户通过用户名和密码生成 API Token
4. THE Backend SHALL 支持 Token 过期机制，默认有效期为 30 天，过期后需重新生成
5. IF Token 已过期, THEN THE Backend SHALL 返回 HTTP 401 响应，并在响应体中标明 token_expired 错误码
6. THE Backend SHALL 对认证失败的请求进行限流，同一 IP 在 5 分钟内认证失败超过 10 次后，暂时拒绝该 IP 的请求 15 分钟

### 需求 10：后端对话查询 API

**用户故事：** 作为前端应用用户，我希望后端提供灵活的查询接口，以便我能按各种条件检索对话记录。

#### 验收标准

1. THE Backend SHALL 提供 `GET /api/v1/conversations` 端点，支持分页查询对话列表，默认每页 20 条，最大每页 100 条
2. THE Backend SHALL 支持以下查询过滤条件：平台来源（支持多选）、时间范围（起止时间）、同步状态
3. THE Backend SHALL 支持按创建时间或更新时间排序，默认按创建时间降序
4. THE Backend SHALL 提供 `GET /api/v1/conversations/:id` 端点，返回单个对话的完整详情，包含所有消息内容
5. THE Backend SHALL 提供 `GET /api/v1/conversations/:id/messages` 端点，支持分页获取对话中的消息列表
6. WHEN 查询结果为空, THE Backend SHALL 返回 HTTP 200 响应，包含空数组和总数为 0 的分页信息
7. THE Backend SHALL 在列表查询响应中包含分页元数据：总记录数、当前页码、每页条数、总页数

### 需求 11：后端全文搜索

**用户故事：** 作为用户，我希望能通过关键词搜索所有对话内容，以便快速找到我需要的信息。

#### 验收标准

1. THE Backend SHALL 提供 `GET /api/v1/search` 端点，支持对对话消息内容进行全文搜索
2. THE Search_Engine SHALL 支持中文和英文的分词搜索，搜索关键词最少 2 个字符，最多 200 个字符
3. THE Backend SHALL 在搜索结果中返回匹配的对话摘要、匹配消息的上下文片段（前后各 50 字符）和高亮标记
4. THE Backend SHALL 支持搜索结果按相关度或时间排序
5. THE Backend SHALL 支持搜索时附加过滤条件：平台来源、时间范围
6. IF 搜索关键词为空或少于 2 个字符, THEN THE Backend SHALL 返回 HTTP 400 响应，提示关键词长度不足
7. THE Backend SHALL 对搜索请求进行限流，单用户每分钟最多 30 次搜索请求

### 需求 12：后端数据统计 API

**用户故事：** 作为用户，我希望能看到对话数据的统计概览，以便了解我的 AI 使用情况。

#### 验收标准

1. THE Backend SHALL 提供 `GET /api/v1/stats/overview` 端点，返回总对话数、总消息数、各平台对话数分布
2. THE Backend SHALL 提供 `GET /api/v1/stats/timeline` 端点，返回按天/周/月聚合的对话数量趋势数据
3. THE Backend SHALL 支持统计接口的时间范围过滤，默认返回最近 30 天的数据
4. THE Backend SHALL 对统计结果进行缓存，缓存有效期为 5 分钟，避免频繁计算

### 需求 13：后端数据导出

**用户故事：** 作为用户，我希望能导出我的对话数据，以便备份或在其他工具中使用。

#### 验收标准

1. THE Backend SHALL 提供 `POST /api/v1/export` 端点，支持导出对话数据为 JSON 格式
2. THE Backend SHALL 支持导出时按平台和时间范围过滤要导出的数据
3. THE Backend SHALL 支持导出为 Markdown 格式，每个对话生成一个 Markdown 文件，打包为 ZIP 下载
4. IF 导出数据量超过 1000 条对话, THEN THE Backend SHALL 采用异步导出方式，返回任务 ID，用户通过 `GET /api/v1/export/:taskId` 查询导出进度和下载链接
5. THE Backend SHALL 对导出文件设置 24 小时的下载有效期，过期后自动清理

### 需求 14：前端对话列表页

**用户故事：** 作为用户，我希望在 Web 界面上浏览所有收集到的对话记录，以便快速找到需要的对话。

#### 验收标准

1. THE Frontend SHALL 展示对话列表页，每条对话显示：平台图标、对话标题（取首条用户消息的前 50 字符）、消息数量、创建时间
2. THE Frontend SHALL 支持按平台筛选对话列表，提供多选平台过滤器
3. THE Frontend SHALL 支持按时间范围筛选，提供日期选择器选择起止日期
4. THE Frontend SHALL 支持无限滚动或分页加载，每次加载 20 条对话
5. WHEN 用户点击某条对话, THE Frontend SHALL 导航到对话详情页
6. IF 对话列表为空, THEN THE Frontend SHALL 显示空状态引导页，提示用户安装插件并开始收集对话
7. THE Frontend SHALL 在列表顶部显示当前筛选条件和匹配的对话总数

### 需求 15：前端对话详情页

**用户故事：** 作为用户，我希望能查看完整的对话内容，以便回顾 AI 的回答。

#### 验收标准

1. THE Frontend SHALL 以聊天气泡形式展示对话中的所有消息，用户消息靠右、AI 回复靠左
2. THE Frontend SHALL 支持 Markdown 渲染，正确显示 AI 回复中的代码块、列表、表格等格式
3. THE Frontend SHALL 在对话详情页顶部显示元信息：平台来源、对话 ID、创建时间、消息总数
4. THE Frontend SHALL 提供复制单条消息内容的功能按钮
5. THE Frontend SHALL 提供导出当前对话为 Markdown 文件的功能
6. IF 对话中的某条消息被标记为不完整状态, THEN THE Frontend SHALL 在该消息旁显示"内容不完整"的提示标记
7. THE Frontend SHALL 支持对话内容的浏览器内搜索（Ctrl+F）高亮

### 需求 16：前端全文搜索页

**用户故事：** 作为用户，我希望能通过关键词搜索所有对话内容，以便快速定位包含特定信息的对话。

#### 验收标准

1. THE Frontend SHALL 提供全局搜索框，支持输入关键词搜索所有对话的消息内容
2. THE Frontend SHALL 在搜索结果中展示：匹配的对话标题、匹配消息的上下文片段（关键词高亮）、平台来源、时间
3. THE Frontend SHALL 支持搜索结果按相关度或时间排序切换
4. THE Frontend SHALL 支持搜索时附加平台和时间范围过滤条件
5. WHEN 用户点击搜索结果中的某条记录, THE Frontend SHALL 跳转到对应对话详情页，并自动滚动到匹配的消息位置
6. THE Frontend SHALL 在用户输入时提供 300ms 的防抖处理，避免频繁发起搜索请求
7. IF 搜索无结果, THEN THE Frontend SHALL 显示空状态提示，建议用户调整关键词或筛选条件

### 需求 17：前端统计面板

**用户故事：** 作为用户，我希望能看到可视化的使用统计，以便了解我在各 AI 平台的使用情况。

#### 验收标准

1. THE Frontend SHALL 展示统计概览卡片：总对话数、总消息数、本周新增对话数
2. THE Frontend SHALL 展示各平台对话数量的饼图或柱状图分布
3. THE Frontend SHALL 展示对话数量的时间趋势折线图，支持按天/周/月切换粒度
4. THE Frontend SHALL 支持统计面板的时间范围选择，默认展示最近 30 天
5. THE Frontend SHALL 在数据加载过程中显示骨架屏或加载动画，避免页面闪烁

### 需求 18：前端用户设置页

**用户故事：** 作为用户，我希望在 Web 界面上管理我的账户和偏好设置。

#### 验收标准

1. THE Frontend SHALL 提供用户设置页，允许用户修改密码和重新生成 API Token
2. THE Frontend SHALL 在设置页展示当前 API Token（部分遮蔽显示），并提供复制完整 Token 的功能
3. WHEN 用户重新生成 API Token, THE Frontend SHALL 显示确认对话框，提示旧 Token 将立即失效
4. THE Frontend SHALL 提供数据管理入口，允许用户批量删除指定平台或时间范围的对话数据
5. WHEN 用户执行批量删除操作, THE Frontend SHALL 显示确认对话框，明确告知将删除的数据数量且操作不可恢复
6. THE Frontend SHALL 提供主题切换功能，支持浅色和深色模式
