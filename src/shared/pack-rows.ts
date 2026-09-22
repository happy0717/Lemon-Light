export interface PackedRow {
  count: number
  avail: number
  contentWidth: number
  scroll: boolean
}

function rangeWidth(widths: number[], from: number, count: number, gap: number): number {
  let sum = 0
  for (let i = from; i < from + count; i += 1) {
    sum += (widths[i] ?? 0) + (i > from ? gap : 0)
  }
  return sum
}

function fitCount(widths: number[], from: number, avail: number, gap: number): number {
  let count = 0
  while (from + count < widths.length && rangeWidth(widths, from, count + 1, gap) <= avail) {
    count += 1
  }
  return count
}

function packBottomUp(widths: number[], gap: number, avails: number[]): PackedRow[] {
  const rows: PackedRow[] = []
  let cursor = 0
  for (const avail of avails) {
    if (cursor >= widths.length) break
    let count = fitCount(widths, cursor, avail, gap)
    if (count === 0) count = 1
    rows.push({
      count,
      avail,
      contentWidth: rangeWidth(widths, cursor, count, gap),
      scroll: false
    })
    cursor += count
  }
  return rows
}

export function packRowsFromBottom(
  widths: number[],
  gap: number,
  rowWidths: number[],
  topReserve = 0
): PackedRow[] {
  const total = widths.length
  const maxRows = rowWidths.length
  if (total === 0 || maxRows === 0) return []

  const fullAt = (index: number): number => Math.max(1, rowWidths[index] ?? 0)
  const reservedAt = (index: number): number => Math.max(1, fullAt(index) - topReserve)

  let rows: PackedRow[] = []
  for (let k = 1; k <= maxRows; k += 1) {
    const avails: number[] = []
    for (let i = 0; i < k; i += 1) {
      avails.push(i === k - 1 ? reservedAt(i) : fullAt(i))
    }
    rows = packBottomUp(widths, gap, avails)
    const placed = rows.reduce((sum, row) => sum + row.count, 0)
    if (placed >= total) {
      if (rows.length < k) {
        const last = rows[rows.length - 1]
        if (last) last.avail = fullAt(rows.length - 1)
        while (rows.length < k) {
          rows.push({
            count: 0,
            avail: reservedAt(rows.length),
            contentWidth: 0,
            scroll: false
          })
        }
      }
      break
    }
    if (k === maxRows) {
      const last = rows[rows.length - 1]
      const placedNow = rows.reduce((sum, row) => sum + row.count, 0)
      if (last && placedNow < total) {
        const start = placedNow - last.count
        last.count += total - placedNow
        last.contentWidth = rangeWidth(widths, start, last.count, gap)
      }
    }
  }

  for (const row of rows) {
    row.scroll = row.count > 1 && row.contentWidth > row.avail
  }
  return rows
}

export function samePack(a: PackedRow[] | null, b: PackedRow[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!
    const y = b[i]!
    if (x.count !== y.count || x.scroll !== y.scroll) return false
  }
  return true
}
