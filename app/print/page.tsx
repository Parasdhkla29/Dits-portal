"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { DailyEntry, ComputedEntry } from "@/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function printDate(iso: string) {
  if (!iso) return "-----";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y.slice(2)}`;
}

function num(val: number | null | undefined) {
  if (val == null) return "";
  return val.toLocaleString("en-IN");
}

function computeBalances(entries: DailyEntry[]): ComputedEntry[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  let runningBal = 0;
  return sorted.map((e, idx) => {
    const lastBalance = runningBal;
    const totalAmount = e.amount_received + lastBalance;
    const balance = totalAmount - (e.amount_deposited ?? 0);
    runningBal = balance;
    return { ...e, sr_no: idx + 1, last_balance: lastBalance, total_amount: totalAmount, balance };
  });
}

// ── column definitions ────────────────────────────────────────────────────────

const COLS = [
  { label: "Sr.\nNo.",             width: "5%",   align: "center" as const },
  { label: "Date",                 width: "10%",  align: "center" as const },
  { label: "Registered\nDeed",     width: "9%",   align: "center" as const },
  { label: "Amount\nReceived",     width: "13%",  align: "right"  as const },
  { label: "Last\nBalance",        width: "11%",  align: "right"  as const },
  { label: "Total\nAmount",        width: "13%",  align: "right"  as const },
  { label: "Amount\nDeposited",    width: "13%",  align: "right"  as const },
  { label: "Deposit\nDate",        width: "11%",  align: "center" as const },
  { label: "Balance",              width: "11%",  align: "right"  as const },
];

// ── styles (inline so they survive @media print reliably) ─────────────────────

const S = {
  th: {
    border: "1px solid #1f2937",
    padding: "4px 3px",
    fontSize: "9px",
    fontWeight: "bold",
    textAlign: "center" as const,
    backgroundColor: "#e5e7eb",
    lineHeight: "1.35",
    whiteSpace: "pre-line" as const,
    verticalAlign: "middle" as const,
  },
  td: {
    border: "1px solid #4b5563",
    padding: "3px 4px",
    fontSize: "10px",
    lineHeight: "1.4",
    verticalAlign: "middle" as const,
  },
  tdAlt: {
    border: "1px solid #4b5563",
    padding: "3px 4px",
    fontSize: "10px",
    lineHeight: "1.4",
    backgroundColor: "#f9fafb",
    verticalAlign: "middle" as const,
  },
  tfTd: {
    border: "1px solid #1f2937",
    padding: "4px 3px",
    fontSize: "10px",
    fontWeight: "bold",
    backgroundColor: "#e5e7eb",
    verticalAlign: "middle" as const,
  },
};

// ── component ─────────────────────────────────────────────────────────────────

function PrintContent() {
  const params   = useSearchParams();
  const heading  = params.get("heading") ?? "";
  const month    = params.get("month")   ?? "";
  const idsParam = params.get("ids")     ?? "";

  const [rows, setRows]       = useState<ComputedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res  = await fetch("/api/entries");
    const all: DailyEntry[] = await res.json();
    const computed = computeBalances(all);

    let filtered: ComputedEntry[];
    if (idsParam) {
      const ids = new Set(idsParam.split(","));
      filtered = computed.filter((e) => ids.has(e.id));
    } else if (month) {
      filtered = computed.filter((e) => e.date.startsWith(month));
    } else {
      filtered = computed;
    }

    setRows(filtered.map((e, i) => ({ ...e, sr_no: i + 1 })));
    setLoading(false);
    // Auto-open print dialog once data is ready
    setTimeout(() => window.print(), 300);
  }, [month, idsParam]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#9ca3af", fontSize: "16px" }}>
        Loading…
      </div>
    );
  }

  const totals = rows.reduce(
    (acc, e) => ({
      deeds:     acc.deeds     + e.registered_deeds,
      received:  acc.received  + e.amount_received,
      deposited: acc.deposited + (e.amount_deposited ?? 0),
    }),
    { deeds: 0, received: 0, deposited: 0 }
  );

  return (
    <div style={{ backgroundColor: "white", minHeight: "100vh", fontFamily: "Arial, Helvetica, sans-serif" }}>

      {/* ── Toolbar (screen only) ── */}
      <div className="no-print" style={{ background: "#f3f4f6", borderBottom: "1px solid #d1d5db", padding: "10px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => window.print()}
          style={{ background: "#2563eb", color: "white", border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
        >
          Print / Save PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{ background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: "8px", padding: "8px 16px", fontSize: "14px", cursor: "pointer" }}
        >
          Close
        </button>
        <span style={{ color: "#6b7280", fontSize: "13px" }}>{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
      </div>

      {/* ── Print body ── */}
      <div style={{ padding: "24px 28px" }}>

        {/* Heading — single line */}
        <div style={{ textAlign: "center", marginBottom: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            DITS FEES DETAILS TEHSIL NILOKHERI{heading ? ` OF MONTH ${heading}` : ""}
          </div>
        </div>

        {/* Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {COLS.map((c, i) => <col key={i} style={{ width: c.width }} />)}
          </colgroup>

          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.label} style={S.th}>{c.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((e, i) => {
              const td = i % 2 === 0 ? S.td : S.tdAlt;
              return (
                <tr key={e.id}>
                  <td style={{ ...td, textAlign: "center" }}>{e.sr_no}</td>
                  <td style={{ ...td, textAlign: "center" }}>{printDate(e.date)}</td>
                  <td style={{ ...td, textAlign: "center" }}>{e.registered_deeds}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(e.amount_received)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(e.last_balance)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{num(e.total_amount)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {e.amount_deposited != null ? num(e.amount_deposited) : ""}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {e.deposit_date ? printDate(e.deposit_date) : "-----"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: "600" }}>{num(e.balance)}</td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <td style={{ ...S.tfTd, textAlign: "center" }} colSpan={2}>Total</td>
              <td style={{ ...S.tfTd, textAlign: "center" }}>{totals.deeds}</td>
              <td style={{ ...S.tfTd, textAlign: "right" }}>{num(totals.received)}</td>
              <td style={{ ...S.tfTd }}></td>
              <td style={{ ...S.tfTd }}></td>
              <td style={{ ...S.tfTd, textAlign: "right" }}>{num(totals.deposited)}</td>
              <td style={{ ...S.tfTd }}></td>
              <td style={{ ...S.tfTd, textAlign: "right" }}>{num(totals.received - totals.deposited)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Signature */}
        <div style={{ marginTop: "48px", display: "flex", justifyContent: "flex-end" }}>
          <div style={{ textAlign: "center", fontSize: "11px", fontWeight: "600" }}>
            Naib Tehsildar, Nilokheri
          </div>
        </div>

      </div>

      {/* Print CSS — margin:0 removes browser-added date/URL headers & footers */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 10mm 10mm 12mm 10mm; background: white; box-sizing: border-box; }
          body, div { min-height: 0 !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#9ca3af" }}>
        Loading…
      </div>
    }>
      <PrintContent />
    </Suspense>
  );
}
