import client from './client'
import { StatsOverview, TimelinePoint, ActivityStats, InsightsStats } from '../types'

// JS getTimezoneOffset: UTC+8 → -480. The backend negates this to shift stored
// UTC timestamps into the caller's local zone before bucketing.
function tzOffset(): number {
  return new Date().getTimezoneOffset()
}

export async function getOverview(): Promise<StatsOverview> {
  const { data } = await client.get('/stats/overview')
  return data
}

export async function getTimeline(params: {
  granularity?: string
  metric?: string
  range?: string
  start_time?: string
  end_time?: string
}): Promise<{ granularity: string; metric: string; data: TimelinePoint[] }> {
  const { data } = await client.get('/stats/timeline', {
    params: { ...params, tz_offset: tzOffset() },
  })
  return data
}

export async function getActivity(): Promise<ActivityStats> {
  const { data } = await client.get('/stats/activity', {
    params: { tz_offset: tzOffset() },
  })
  return data
}

export async function getInsights(): Promise<InsightsStats> {
  const { data } = await client.get('/stats/insights')
  return data
}
