import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const client = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: {
    indexes: null,
  },
})

// Request interceptor: inject auth token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle 401 with refresh-token retry.
// Multiple concurrent 401s share a single in-flight refresh promise to avoid a thundering herd.
let refreshPromise: Promise<string | null> | null = null

async function attemptRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) return null
  try {
    // Bypass the interceptor by using axios directly (avoid recursive 401 handling)
    const resp = await axios.post(`${API_BASE}/api/v1/auth/refresh`, {
      refresh_token: refreshToken,
    })
    const { access_token, refresh_token } = resp.data
    localStorage.setItem('access_token', access_token)
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token)
    return access_token as string
  } catch {
    return null
  }
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    if (!original || error.response?.status !== 401) {
      return Promise.reject(error)
    }
    // Avoid infinite retry loops
    if (original._retried) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
      return Promise.reject(error)
    }
    // Don't retry refresh itself — that would loop
    if (original.url?.includes('/auth/refresh')) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
      return Promise.reject(error)
    }

    if (!refreshPromise) {
      refreshPromise = attemptRefresh().finally(() => {
        refreshPromise = null
      })
    }
    const newToken = await refreshPromise
    if (newToken) {
      original.headers.Authorization = `Bearer ${newToken}`
      original._retried = true
      return client.request(original)
    }

    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    window.location.href = '/login'
    return Promise.reject(error)
  },
)

export default client
