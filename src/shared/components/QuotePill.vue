<script setup lang="ts">
import type { Quote } from '@shared/types'
import { formatChangePercent, formatPrice, trendClass } from '../format'

const props = defineProps<{
  quote: Quote
  compact?: boolean
}>()
</script>

<template>
  <div class="pill" :class="trendClass(quote.changePercent)">
    <span class="pill-name" :title="`${quote.name} ${quote.symbol}`">
      {{ quote.name }}
    </span>
    <span class="pill-price num">{{ formatPrice(quote.price, quote) }}</span>
    <span class="pill-change num">{{ formatChangePercent(quote.changePercent) }}</span>
  </div>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  cursor: grab;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.pill:hover {
  background: rgba(255, 255, 255, 0.06);
}

.pill-name {
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-price {
  font-size: 13px;
  font-weight: 600;
}

.pill-change {
  font-size: 12px;
  font-weight: 500;
}

.pill.up .pill-price,
.pill.up .pill-change {
  color: var(--up);
}

.pill.down .pill-price,
.pill.down .pill-change {
  color: var(--down);
}

.pill.flat .pill-price,
.pill.flat .pill-change {
  color: var(--flat);
}
</style>
