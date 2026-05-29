import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

const client = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: inject auth token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle auth errors
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default client
