import * as XLSX from 'xlsx'
import type { ParsedExcelData } from '@/types'

// ── tiny helpers ─────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0') }

function serialToISO(s: number): string {
  const d = new Date((s - 25569) * 86_400_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Try to extract a YYYY-MM-DD date from any cell value. */
function tryDate(val: unknown): string {
  if (val == null || val === '') return ''
  if (val instanceof Date && !isNaN(val.getTime())) return localISO(val)

  const n = Number(val)
  // Excel date serial: 1 = 1900-01-01, ~46000 = 2025-xx-xx
  if (!isNaN(n) && n >= 20000 && n <= 60000) return serialToISO(n)

  const s = String(val).trim()
  if (s.length < 6) return ''

  // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${year}-${pad(+dmy[2])}-${pad(+dmy[1])}`
  }
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  const d = new Date(s)
  if (!isNaN(d.getTime())) return localISO(d)
  return ''
}

/** Any value → number (strips commas). */
function toNum(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  const n = parseFloat(String(val).replace(/,/g, '').trim())
  return isNaN(n) ? 0 : n
}

/** True when val looks like a row serial number (positive integer). */
function isSerial(val: unknown): boolean {
  const n = toNum(val)
  return Number.isInteger(n) && n >= 1
}

/** True when a cell's text looks like a total/summary label. */
function isTotalLabel(val: unknown): boolean {
  return /total|grand|sub\s*total|कुल|योग|sum/i.test(String(val ?? ''))
}

// ── main export ───────────────────────────────────────────────────────────────

export function parseExcelFile(buffer: ArrayBuffer): ParsedExcelData {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: false,
    raw: true,
  })

  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : null
  if (!sheet) return { date: '', registeredDeeds: 0, amountReceived: 0 }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][]

  // ── 1. Date: first date-like cell in the whole sheet ─────────────────────
  let date = ''
  outer:
  for (const row of rows) {
    if (!row) continue
    for (const cell of row) {
      const d = tryDate(cell)
      if (d) { date = d; break outer }
    }
  }

  // ── 2. Locate the data block ──────────────────────────────────────────────
  // Find the first row whose first cell is a serial number (row 1, 2, 3…).
  // Everything before that is headers/title. Everything after is data.
  let dataStart = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row && isSerial(row[0])) { dataStart = i; break }
  }

  // ── 3. Walk data rows: count deeds and look for a total row ──────────────
  let registeredDeeds = 0
  let amountReceived  = 0

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    // Skip completely empty rows
    const nonNull = row.filter(c => c != null && String(c).trim() !== '')
    if (nonNull.length === 0) continue

    // ── Total / summary row ──
    if (row.some(isTotalLabel)) {
      // Collect all positive numbers not in a label cell
      const nums = row
        .filter(c => !isTotalLabel(c))
        .map(c => toNum(c))
        .filter(n => n > 0)
        .sort((a, b) => b - a)          // descending

      if (nums.length === 1) {
        amountReceived = nums[0]
      } else if (nums.length > 1) {
        // If the largest value equals the sum of the rest → it IS the grand total
        const largest  = nums[0]
        const sumRest  = nums.slice(1).reduce((a, b) => a + b, 0)
        amountReceived = Math.abs(largest - sumRest) < 1 ? largest
                                                         : nums.reduce((a, b) => a + b, 0)
      }

      // Back-fill deed count if not yet accumulated
      if (registeredDeeds === 0) {
        for (let j = dataStart; j < i; j++) {
          if (rows[j] && isSerial(rows[j][0])) registeredDeeds++
        }
      }
      break
    }

    // ── Normal data row ──
    if (isSerial(row[0])) registeredDeeds++
  }

  // ── 4. Fallback deed count: any row whose first cell is a serial number ───
  if (registeredDeeds === 0) {
    for (const row of rows) {
      if (row && isSerial(row[0])) registeredDeeds++
    }
  }

  // ── 5. Fallback amount: sum the rightmost numeric column in data rows ─────
  if (amountReceived === 0 && registeredDeeds > 0) {
    // Find which column index has the most numbers
    const colSums: number[] = []
    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.some(isTotalLabel)) continue
      row.forEach((c, j) => {
        const n = toNum(c)
        if (n > 0) colSums[j] = (colSums[j] ?? 0) + n
      })
    }
    // Pick the rightmost column that has values as the "amount" column
    for (let j = colSums.length - 1; j >= 0; j--) {
      if (colSums[j] > 0) { amountReceived = colSums[j]; break }
    }
  }

  return { date, registeredDeeds, amountReceived }
}
