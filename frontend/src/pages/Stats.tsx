import { useEffect, useState } from 'react'
import { Card, Statistic, Row, Col, Select, Spin } from 'antd'
import ReactECharts from 'echarts-for-react'
import { getOverview, getTimeline } from '../api/stats'
import { StatsOverview, TimelinePoint } from '../types'

export default function Stats() {
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [granularity, setGranularity] = useState('day')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [granularity])

  async function fetchData() {
    setLoading(true)
    try {
      const [ov, tl] = await Promise.all([
        getOverview(),
        getTimeline({ granularity }),
      ])
      setOverview(ov)
      setTimeline(tl.data)
    } catch {
      // handled
    }
    setLoading(false)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '48px' }}><Spin size="large" /></div>
  if (!overview) return null

  const pieOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: Object.entries(overview.platform_distribution).map(([name, value]) => ({ name, value })),
    }],
  }

  const lineOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: timeline.map((t) => t.date) },
    yAxis: { type: 'value' },
    series: [{
      type: 'line',
      data: timeline.map((t) => t.count),
      smooth: true,
      areaStyle: { opacity: 0.1 },
    }],
  }

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>使用统计</h2>

      {/* Overview Cards */}
      <Row gutter={16} style={{ marginBottom: '24px' }}>
        <Col span={8}>
          <Card><Statistic title="总对话数" value={overview.total_conversations} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="总消息数" value={overview.total_messages} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="本周新增" value={overview.this_week_new} /></Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={16}>
        <Col span={10}>
          <Card title="平台分布">
            <ReactECharts option={pieOption} style={{ height: '300px' }} />
          </Card>
        </Col>
        <Col span={14}>
          <Card
            title="对话趋势"
            extra={
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
            }
          >
            <ReactECharts option={lineOption} style={{ height: '300px' }} />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
