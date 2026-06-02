import { Platform } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class DoubaoAdapter extends PlatformAdapter {
  platform: Platform = 'doubao'

  // TODO: capture real API paths via Playwright
  urlPatterns = [
    // Turn (POST): unverified patterns, needs real capture
    'https://www.doubao.com/chat/api/chat',
    'https://doubao.com/chat/api/chat',
    'https://www.doubao.com/samantha/chat/completion',
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
    return { success: false, error: 'Doubao turn mode: pending adaptation (need real API capture)' }
  }

  private parseHistoryResponse(_response: CapturedResponse): ParseResult {
    // TODO: implement after Playwright capture reveals real history response format
    return { success: false, error: 'Doubao history mode: pending adaptation (need real API capture)' }
  }
}
