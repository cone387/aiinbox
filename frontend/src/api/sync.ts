import client from './client'

export interface PlatformSyncStatus {
  platform: string
  last_synced_at: string | null
  unread_count: number
}

export async function getSyncStatus(): Promise<PlatformSyncStatus[]> {
  const { data } = await client.get('/sync/status')
  return data.platforms
}

export async function markRead(convId: number): Promise<void> {
  await client.post(`/conversations/${convId}/read`)
}

export async function markAllRead(platform?: string): Promise<void> {
  await client.post('/conversations/read-all', platform ? { platform } : {})
}
