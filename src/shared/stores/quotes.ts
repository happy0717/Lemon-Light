import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { Quote, QuotesPayload } from '@shared/types'
import { bridge } from '../bridge'

export const useQuoteStore = defineStore('quotes', () => {
  const state = reactive({
    quotes: {} as Record<string, Quote>,
    lastUpdated: 0
  })

  async function init(): Promise<void> {
    const snapshot = await bridge.getQuoteSnapshot()
    applyPayload(snapshot)
    bridge.onQuotesSync((payload) => applyPayload(payload))
  }

  function applyPayload(payload: QuotesPayload): void {
    state.quotes = { ...state.quotes, ...payload.quotes }
    state.lastUpdated = payload.lastUpdated
  }

  async function refresh(force = false): Promise<void> {
    const payload = await bridge.fetchQuotes(force)
    applyPayload(payload)
  }

  return { state, init, refresh }
})
