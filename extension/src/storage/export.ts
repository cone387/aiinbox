import { Platform } from '../types'
import { getAllConversations } from './db'

export async function exportAsJSON(filter?: { platform?: Platform; syncStatus?: string }): Promise<string> {
  let conversations = await getAllConversations()

  if (filter?.platform) {
    conversations = conversations.filter(c => c.platform === filter.platform)
  }
  if (filter?.syncStatus) {
    conversations = conversations.filter(c => c.syncStatus === filter.syncStatus)
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    total: conversations.length,
    conversations: conversations.map(c => ({
      platform: c.platform,
      conversationId: c.conversationId,
      title: c.title,
      messages: c.messages,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      captureMode: c.captureMode,
    })),
  }

  return JSON.stringify(exportData, null, 2)
}

export async function exportAsMarkdown(filter?: { platform?: Platform }): Promise<string> {
  let conversations = await getAllConversations()

  if (filter?.platform) {
    conversations = conversations.filter(c => c.platform === filter.platform)
  }

  conversations.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  let md = '# AI Inbox Export\n\n'
  md += `导出时间: ${new Date().toISOString()}\n`
  md += `对话数量: ${conversations.length}\n\n---\n\n`

  for (const conv of conversations) {
    md += `## ${conv.title || 'Untitled'}\n\n`
    md += `平台: ${conv.platform} | 创建: ${conv.createdAt} | 消息数: ${conv.messages.length}\n\n`

    for (const msg of conv.messages) {
      const roleLabel = msg.role === 'user' ? '**用户**' : '**AI**'
      md += `${roleLabel} (${msg.timestamp})\n\n`
      md += `${msg.content}\n\n---\n\n`
    }
  }

  return md
}

export function downloadBlob(content: string, filename: string, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
