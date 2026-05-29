import client from './client'

export interface APITokenView {
  id: number
  name: string
  token: string
  expires_at: string
  last_used: string
  created_at: string
}

export interface APITokenFull {
  id: number
  name: string
  token: string
  expires_at: string
  created_at: string
}

export async function listTokens(): Promise<APITokenView[]> {
  const { data } = await client.get('/auth/tokens')
  return data.tokens || []
}

export async function createToken(name: string): Promise<APITokenFull> {
  const { data } = await client.post('/auth/token', { name })
  return data
}

export async function deleteToken(id: number): Promise<void> {
  await client.delete('/auth/token', { data: { id } })
}
