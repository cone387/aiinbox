import client from './client'
import { TokenPair } from '../types'

export async function login(username: string, password: string): Promise<TokenPair> {
  const { data } = await client.post<TokenPair>('/auth/login', { username, password })
  localStorage.setItem('access_token', data.access_token)
  localStorage.setItem('refresh_token', data.refresh_token)
  return data
}

export async function register(username: string, password: string): Promise<void> {
  await client.post('/auth/register', { username, password })
}

export async function generateAPIToken(): Promise<{ api_token: string; expires_at: string }> {
  const { data } = await client.post('/auth/token')
  return data
}

export function logout(): void {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  window.location.href = '/login'
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('access_token')
}
