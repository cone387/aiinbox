import { useEffect, useState } from 'react'
import { Card, Statistic, Row, Col, Select, Spin, Result, Button, Empty, Segmented } from 'antd'
import {
  MessageOutlined,
  CommentOutlined,
  RiseOutlined,
  ApartmentOutlined,
  ReloadOutlined,
  SwapOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { getOverview, getTimeline, getActivity, getInsights } from '../api/stats'
import { StatsOverview, TimelineResponse, ActivityStats, InsightsStats } from '../types'

// Brand-ish accent per platform so the pie reads at a glance and stays stable
// across renders (ECharts would otherwise recolor by index).
const PLATFORM_META: Record<string, { label: string; color: string }> = {
  chatgpt: { label: 'ChatGPT', color: '#10a37f' },
  gemini: { label: 'Gemini', color: '#4285f4' },
  tongyi: { label: '通义千问', color: '#615ced' },
  doubao: { label: '豆包', color: '#1664ff' },
}
const FALLBACK_COLORS = ['#8c54ff', '#f5a623', '#eb2f96', '#13c2c2', '#fa8c16']

function platformLabel(name: string): string {
  return PLATFORM_META[name]?.label || name
}
function platformColor(name: string, index: number): string {
  return PLATFORM_META[name]?.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const STAT_CARDS = [
  { key: 'total_conversations', title: '总对话数', icon: <MessageOutlined />, color: '#1677ff' },
  { key: 'total_messages', title: '总消息数', icon: <CommentOutlined />, color: '#13c2c2' },
  { key: 'this_week_new', title: '本周新增', icon: <RiseOutlined />, color: '#52c41a' },
  { key: 'platforms', title: '覆盖平台', icon: <ApartmentOutlined />, color: '#722ed1' },
  { key: 'avg_messages_per_conv', title: '平均对话长度', icon: <SwapOutlined />, color: '#fa8c16' },
  { key: 'unread_count', title: '未读对话', icon: <ReadOutlined />, color: '#eb2f96' },
] as const

const cardShadow = { boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }

export default function Stats() {
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null)
  const [activity, setActivity] = useState<ActivityStats | null>(null)
  const [insights, setInsights] = useState<InsightsStats | null>(null)
  const [granularity, setGranularity] = useState('day')
  const [range, setRange] = useState('30d')
  const [trendMetric, setTrendMetric] = useState<'conversations' | 'messages'>('conversations')
  const [pieMetric, setPieMetric] = useState<'conversations' | 'messages'>('conversations')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchData()
  }, [granularity, trendMetric, range])

  async function fetchData() {
    setLoading(true)
    setError(false)
    try {
      const [ov, tl, ac, ins] = await Promise.all([
        getOverview(),
        getTimeline({ granularity, metric: trendMetric, range }),
        getActivity(),
        getInsights(),
      ])
      setOverview(ov)
      setTimeline(tl)
      setActivity(ac)
      setInsights(ins)
    } catch {
      setError(true)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 0' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (error || !overview) {
    return (
      <Result
        status="warning"
        title="统计数据加载失败"
        subTitle="服务可能正忙（如刚完成大量同步触发限流），请稍后重试。"
        extra={
          <Button type="primary" icon={<ReloadOutlined />} onClick={fetchData}>
            重新加载
          </Button>
        }
      />
    )
  }

  const platformEntries = Object.entries(overview.platform_distribution)
  const statValues: Record<string, number | string> = {
    total_conversations: overview.total_conversations,
    total_messages: overview.total_messages,
    this_week_new: overview.this_week_new,
    platforms: platformEntries.length,
    avg_messages_per_conv: overview.avg_messages_per_conv.toFixed(1),
    unread_count: overview.unread_count,
  }

  const pieDist =
    pieMetric === 'messages' ? overview.platform_msg_distribution : overview.platform_distribution
  const pieEntries = Object.entries(pieDist)

  const pieOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle' },
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 18, fontWeight: 600, formatter: '{b}\n{d}%' },
          scale: true,
        },
        data: pieEntries.map(([name, value], i) => ({
          name: platformLabel(name),
          value,
          itemStyle: { color: platformColor(name, i) },
        })),
      },
    ],
  }

  // One line per platform so trends can be compared; the legend toggles series.
  const trendDates = timeline?.dates || []
  const trendSeries = timeline?.series || []
  const trendHasData = trendSeries.some((s) => s.data.some((v) => v > 0))
  const lineOption = {
    grid: { left: 12, right: 20, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: {
      top: 0,
      icon: 'circle',
      data: trendSeries.map((s) => platformLabel(s.platform)),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendDates,
      axisLine: { lineStyle: { color: '#d9d9d9' } },
      axisLabel: { color: '#8c8c8c' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f0f0f0' } },
      axisLabel: { color: '#8c8c8c' },
    },
    series: trendSeries.map((s, i) => ({
      name: platformLabel(s.platform),
      type: 'line',
      data: s.data,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2.5, color: platformColor(s.platform, i) },
      itemStyle: { color: platformColor(s.platform, i) },
    })),
  }

  // Usage-habits heatmap: 7 weekdays × 24 hours.
  const heatData = (activity?.heatmap || []).map((c) => [c.hour, c.weekday, c.count])
  const heatMax = Math.max(1, ...heatData.map((d) => d[2]))
  const heatmapOption = {
    tooltip: {
      position: 'top',
      formatter: (p: any) =>
        `${WEEKDAYS[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00 — ${p.value[2]} 条消息`,
    },
    grid: { left: 50, right: 16, top: 10, bottom: 60, containLabel: false },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => i),
      splitArea: { show: true },
      axisLabel: { color: '#8c8c8c', interval: 1 },
      axisLine: { lineStyle: { color: '#d9d9d9' } },
    },
    yAxis: {
      type: 'category',
      data: WEEKDAYS,
      splitArea: { show: true },
      axisLabel: { color: '#8c8c8c' },
      axisLine: { lineStyle: { color: '#d9d9d9' } },
    },
    visualMap: {
      min: 0,
      max: heatMax,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 8,
      inRange: { color: ['#eaf3ff', '#1677ff', '#0050b3'] },
    },
    series: [
      {
        type: 'heatmap',
        data: heatData,
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.2)' } },
      },
    ],
  }

  // Content insights: role distribution (questions vs replies).
  const roleOption = insights && {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle' },
    series: [
      {
        type: 'pie',
        radius: ['50%', '72%'],
        center: ['50%', '46%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 16, fontWeight: 600, formatter: '{b}\n{d}%' } },
        data: [
          { name: '提问', value: insights.user_messages, itemStyle: { color: '#1677ff' } },
          { name: '回复', value: insights.assistant_messages, itemStyle: { color: '#52c41a' } },
        ],
      },
    ],
  }

  // Per-platform average reply length.
  const replyEntries = Object.entries(insights?.platform_avg_reply_length || {})
  const replyOption = {
    grid: { left: 12, right: 24, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name}: ${Math.round(p[0].value)} 字` },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { color: '#8c8c8c' } },
    yAxis: {
      type: 'category',
      data: replyEntries.map(([name]) => platformLabel(name)),
      axisLabel: { color: '#595959' },
      axisLine: { lineStyle: { color: '#d9d9d9' } },
    },
    series: [
      {
        type: 'bar',
        data: replyEntries.map(([name, v], i) => ({
          value: Math.round(v),
          itemStyle: { color: platformColor(name, i), borderRadius: [0, 6, 6, 0] },
        })),
        barWidth: 18,
      },
    ],
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {STAT_CARDS.map((c) => (
          <Col xs={12} md={8} lg={4} key={c.key}>
            <Card variant="borderless" style={cardShadow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    color: c.color,
                    background: `${c.color}14`,
                    flexShrink: 0,
                  }}
                >
                  {c.icon}
                </div>
                <Statistic title={c.title} value={statValues[c.key]} valueStyle={{ fontWeight: 600 }} />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={10}>
          <Card
            title="平台分布"
            variant="borderless"
            style={cardShadow}
            extra={
              <Segmented
                size="small"
                value={pieMetric}
                onChange={(v) => setPieMetric(v as 'conversations' | 'messages')}
                options={[
                  { label: '会话数', value: 'conversations' },
                  { label: '消息数', value: 'messages' },
                ]}
              />
            }
          >
            {pieEntries.length ? (
              <ReactECharts option={pieOption} style={{ height: 320 }} notMerge />
            ) : (
              <Empty style={{ padding: '90px 0' }} description="暂无数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            title="对话趋势"
            variant="borderless"
            style={cardShadow}
            extra={
              <div style={{ display: 'flex', gap: 8 }}>
                <Segmented
                  size="small"
                  value={trendMetric}
                  onChange={(v) => setTrendMetric(v as 'conversations' | 'messages')}
                  options={[
                    { label: '会话数', value: 'conversations' },
                    { label: '消息数', value: 'messages' },
                  ]}
                />
                <Select
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: '30d', label: '近30天' },
                    { value: '90d', label: '近90天' },
                    { value: '1y', label: '近1年' },
                    { value: 'all', label: '全部' },
                  ]}
                  size="small"
                  style={{ width: 92 }}
                />
                <Select
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: 'day', label: '按天' },
                    { value: 'week', label: '按周' },
                    { value: 'month', label: '按月' },
                  ]}
                  size="small"
                />
              </div>
            }
          >
            {trendHasData ? (
              <ReactECharts option={lineOption} style={{ height: 320 }} notMerge />
            ) : (
              <Empty style={{ padding: '90px 0' }} description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card title="使用习惯" variant="borderless" style={cardShadow}>
            {heatData.some((d) => d[2] > 0) ? (
              <ReactECharts option={heatmapOption} style={{ height: 300 }} notMerge />
            ) : (
              <Empty style={{ padding: '90px 0' }} description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title="提问 / 回复" variant="borderless" style={cardShadow}>
            {insights && insights.user_messages + insights.assistant_messages > 0 ? (
              <ReactECharts option={roleOption} style={{ height: 280 }} notMerge />
            ) : (
              <Empty style={{ padding: '70px 0' }} description="暂无数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card title="平均字数" variant="borderless" style={{ ...cardShadow, height: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '12px 0' }}>
              <Statistic
                title="平均提问字数"
                value={Math.round(insights?.avg_user_chars || 0)}
                suffix="字"
                valueStyle={{ color: '#1677ff', fontWeight: 600 }}
              />
              <Statistic
                title="平均回复字数"
                value={Math.round(insights?.avg_assistant_chars || 0)}
                suffix="字"
                valueStyle={{ color: '#52c41a', fontWeight: 600 }}
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="各平台平均回复长度" variant="borderless" style={cardShadow}>
            {replyEntries.length ? (
              <ReactECharts option={replyOption} style={{ height: 280 }} notMerge />
            ) : (
              <Empty style={{ padding: '70px 0' }} description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
