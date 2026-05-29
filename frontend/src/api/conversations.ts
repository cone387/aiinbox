import client from './client'
import { Conversation, ConversationDetail, Message, PaginatedResponse } from '../types'

export interface ListParams {
  platform?: string[]
  start_time?: string
  end_time?: string
  sort_by?: string
  order?: string
  page?: number
  page_size?: number
}

export async function listConversations(params: ListParams): Promise<PaginatedResponse<Conversation>> {
  const { data } = await client.get('/conversations', { params })
  return data
}

export async function getConversation(id: number): Promise<ConversationDetail> {
  const { data } = await client.get(`/conversations/${id}`)
  return data
}

export async function getMessages(id: number, page = 1, pageSize = 50): Promise<PaginatedResponse<Message>> {
  const { data } = await client.get(`/conversations/${id}/messages`, {
    params: { page, page_size: pageSize },
  })
  return data
}

export async function batchDelete(ids: number[]): Promise<{ deleted: number }> {
  const { data } = await client.delete('/conversations', { data: { ids } })
  return data
}
