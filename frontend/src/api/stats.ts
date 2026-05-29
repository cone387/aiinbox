import client from './client'
import { StatsOverview, TimelinePoint } from '../types'

export async function getOverview(): Promise<StatsOverview> {
  const { data } = await client.get('/stats/overview')
  return data
}

export async function getTimeline(params: {
  granularity?: string
  start_time?: string
  end_time?: string
}): Promise<{ granularity: string; data: TimelinePoint[] }> {
  const { data } = await client.get('/stats/timeline', { params })
  return data
}
