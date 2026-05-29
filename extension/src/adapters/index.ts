import { Platform } from '../types'
import { PlatformAdapter } from './base'
import { ChatGPTAdapter } from './chatgpt'
import { GeminiAdapter } from './gemini'
import { TongyiAdapter } from './tongyi'
import { DoubaoAdapter } from './doubao'

export { PlatformAdapter } from './base'
export type { CapturedResponse, ParseResult } from './base'

const adapters: PlatformAdapter[] = [
  new ChatGPTAdapter(),
  new GeminiAdapter(),
  new TongyiAdapter(),
  new DoubaoAdapter(),
]

export function getAdapter(url: string): PlatformAdapter | null {
  return adapters.find((a) => a.matchRequest(url)) || null
}

export function getAdapterByPlatform(platform: Platform): PlatformAdapter | null {
  return adapters.find((a) => a.platform === platform) || null
}

export function getAllUrlPatterns(): string[] {
  return adapters.flatMap((a) => a.urlPatterns)
}
