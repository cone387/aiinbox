import client from './client'
import { SearchResultItem } from '../types'

export interface SearchParams {
  q: string
  platform?: string[]
  start_time?: string
  end_time?: string
  sort_by?: string
  page?: number
  page_size?: number
}

export interface SearchResponse {
  items: SearchResultItem[]
  total: number
  page: number
  page_size: number
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  const { data } = await client.get('/search', { params })
  return data
}
