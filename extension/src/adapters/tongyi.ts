import { Platform } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class TongyiAdapter extends PlatformAdapter {
  platform: Platform = 'tongyi'

  // TODO: capture real API paths via Playwright
  urlPatterns = [
    // Turn (POST): unverified patterns, needs real capture
    'https://qianwen.biz.aliyun.com/dialog/conversation',
    'https://tongyi.aliyun.com/qianwen/api/chat',
    'https://qianwen.aliyun.com/api/chat',
    // History (GET): TODO — needs Playwright capture to identify
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((pattern) => url.includes(pattern))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    if (response.captureMode === 'history') {
      return this.parseHistoryResponse(response)
    }
    return this.parseTurnResponse(response)
  }

  private parseTurnResponse(_response: CapturedResponse): ParseResult {
    // TODO: implement after Playwright capture reveals real turn response format
    return { success: false, error: 'Tongyi turn mode: pending adaptation (need real API capture)' }
  }

  private parseHistoryResponse(_response: CapturedResponse): ParseResult {
    // TODO: implement after Playwright capture reveals real history response format
    return { success: false, error: 'Tongyi history mode: pending adaptation (need real API capture)' }
  }
}
