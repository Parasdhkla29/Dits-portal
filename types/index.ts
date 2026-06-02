export interface DailyEntry {
  id: string
  date: string
  registered_deeds: number
  amount_received: number
  amount_deposited: number | null
  deposit_date: string | null
  created_at: string
  updated_at: string
}

export interface ComputedEntry extends DailyEntry {
  sr_no: number
  last_balance: number
  total_amount: number
  balance: number
}

export interface ParsedExcelData {
  date: string
  registeredDeeds: number
  amountReceived: number
}
