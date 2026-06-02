import * as XLSX from 'xlsx'
import type { ParsedExcelData } from '@/types'

/** Excel serial → YYYY-MM-DD (handles the Lotus 1-2-3 epoch offset) */
function serialToISO(serial: number): string {
  const d = new Date((serial - 25569) * 86_400_000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Any cell value → YYYY-MM-DD string (uses LOCAL date parts to avoid UTC timezone shift) */
function parseDate(val: unknown): string {
  if (!val) return ''
  if (val instanceof Date) {
    return localISO(val)
  }
  const n = Number(val)
  if (!isNaN(n) && n > 20000) return serialToISO(n)
  const d = new Date(String(val))
  return isNaN(d.getTime()) ? '' : localISO(d)
}

/** Format a Date using local (device) date parts — prevents UTC midnight → prev-day shift in IST */
function localISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Any cell value → number (handles numeric strings like "43500") */
function toNum(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  const n = parseFloat(String(val).replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}

/** True if val looks like a positive integer (number or numeric string) */
function isPosInt(val: unknown): boolean {
  const n = toNum(val)
  return Number.isInteger(n) && n > 0
}

export function parseExcelFile(buffer: ArrayBuffer): ParsedExcelData {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: false,
    raw: true,
  })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })

  let date = ''
  let registeredDeeds = 0
  let amountReceived = 0

  // Find the column-header row (contains "Sr No" and "Date")
  let headerIdx = -1
  let dateColIdx = 4      // column E default
  let totalColIdx = -1    // "Total Amount" column index

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i]
    if (!row) continue
    const lower = row.map((c: any) => String(c ?? '').toLowerCase().trim())
    if (lower.some((c) => /^sr\.?\s*no\.?$/.test(c))) {
      headerIdx = i
      const dIdx = lower.findIndex((c) => c === 'date')
      if (dIdx !== -1) dateColIdx = dIdx
      // "Total Amount" is the last column whose header contains "total"
      for (let j = lower.length - 1; j >= 0; j--) {
        if (lower[j].includes('total')) { totalColIdx = j; break }
      }
      break
    }
  }

  // ── Format A: summary block at TOP ────────────────────────────────────────
  // Row N:   "Total Records" | … | "Grand Total"
  // Row N+1:  6              | … |  10500
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i]
    if (!row) continue
    const lower = row.map((c: any) => String(c ?? '').toLowerCase())
    if (
      lower.some((c) => c.includes('total record')) &&
      lower.some((c) => c.includes('grand total'))
    ) {
      const valRow = rows[i + 1]
      if (valRow) {
        const trIdx = lower.findIndex((c) => c.includes('total record'))
        const gtIdx = lower.findIndex((c) => c.includes('grand total'))
        registeredDeeds = Math.round(toNum(valRow[trIdx]))
        amountReceived  = toNum(valRow[gtIdx])
      }
      break
    }
  }

  // ── Format B: "Grand Total" row at BOTTOM ─────────────────────────────────
  // Row N: … | "Grand Total" | service_sum | other_sum | total_sum
  if (!amountReceived) {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      // Matches "Total:", "Total", "Grand Total", "TOTAL" — but NOT "Total Amount"
      const hasGT = row.some((c: any) => /\btotal:?\s*$/i.test(String(c ?? '').trim()))
      if (!hasGT) continue

      if (totalColIdx >= 0) {
        // We know which column is the "Total Amount" grand total
        amountReceived = toNum(row[totalColIdx])
      } else {
        // No dedicated "Total Amount" column — collect all positive numerics in the row
        // (skip cells that contain the word "total" so we don't count the label)
        const nums = (row as unknown[])
          .filter((c) => !/total/i.test(String(c ?? '')))
          .map((c) => toNum(c))
          .filter((n) => n > 0)

        if (nums.length === 0) {
          amountReceived = 0
        } else if (nums.length === 1) {
          amountReceived = nums[0]
        } else {
          // If the last value equals the sum of all others, it IS a grand-total column → use it.
          // Otherwise (e.g. only Service Amount + Other Amount columns), sum them all.
          const last    = nums[nums.length - 1]
          const sumRest = nums.slice(0, -1).reduce((a, b) => a + b, 0)
          amountReceived = Math.abs(last - sumRest) < 0.01 ? last : nums.reduce((a, b) => a + b, 0)
        }
      }

      // Count data rows above this Grand Total row
      if (!registeredDeeds) {
        for (let j = headerIdx + 1; j < i; j++) {
          const dr = rows[j]
          if (dr && isPosInt(dr[0])) registeredDeeds++
        }
      }
      break
    }
  }

  // ── Extract date from first data row ──────────────────────────────────────
  const dataStart = headerIdx + 1
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    if (isPosInt(row[0])) {
      date = parseDate(row[dateColIdx])
      break
    }
  }

  // ── Last-resort: count all Sr-No rows ─────────────────────────────────────
  if (!registeredDeeds) {
    for (const row of rows) {
      if (row && isPosInt(row[0])) registeredDeeds++
    }
  }

  return { date, registeredDeeds, amountReceived }
}
