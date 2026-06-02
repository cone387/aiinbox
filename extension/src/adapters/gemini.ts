import { Platform } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class GeminiAdapter extends PlatformAdapter {
  platform: Platform = 'gemini'

  // TODO: capture real API paths via Playwright
  urlPatterns = [
    // Turn (POST): unverified patterns, needs real capture
    'https://gemini.google.com/_/BardChatUi/data/',
    'https://gemini.google.com/app/_/data/',
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
    return { success: false, error: 'Gemini turn mode: pending adaptation (need real API capture)' }
  }

  private parseHistoryResponse(_response: CapturedResponse): ParseResult {
    // TODO: implement after Playwright capture reveals real history response format
    return { success: false, error: 'Gemini history mode: pending adaptation (need real API capture)' }
  }
}
