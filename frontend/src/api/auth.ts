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

export async function getAuthStatus(): Promise<{ initialized: boolean }> {
  const { data } = await client.get('/auth/status')
  return data
}

export async function generateAPIToken(name?: string): Promise<{ api_token: string; expires_at: string }> {
  const { data } = await client.post('/auth/token', { name })
  return data
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await client.put('/auth/password', { current_password: currentPassword, new_password: newPassword })
}

export function logout(): void {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  window.location.href = '/login'
}

// Decode a JWT and check its exp claim. Returns true if valid and not expired.
function isTokenValid(token: string | null): boolean {
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (typeof payload.exp !== 'number') return false
    // Consider expired if less than 30s remaining
    return payload.exp > Date.now() / 1000 + 30
  } catch {
    return false
  }
}

export function isAuthenticated(): boolean {
  return isTokenValid(localStorage.getItem('access_token'))
}
