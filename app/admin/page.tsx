"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { DailyEntry, ComputedEntry } from "@/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN");
}

function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function computeBalances(entries: DailyEntry[]): ComputedEntry[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  // Balance ALWAYS carries forward (matches PDF accounting logic).
  // Even a day with 0 deposit passes its full balance to the next row.
  let runningBal = 0;
  return sorted.map((e, idx) => {
    const lastBalance = runningBal;
    const totalAmount = e.amount_received + lastBalance;
    const balance     = totalAmount - (e.amount_deposited ?? 0);
    runningBal = balance;                // carry forward unconditionally
    return { ...e, sr_no: idx + 1, last_balance: lastBalance, total_amount: totalAmount, balance };
  });
}

function getMonths(entries: DailyEntry[]) {
  const s = new Set<string>();
  entries.forEach((e) => {
    const d = new Date(e.date);
    s.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  return Array.from(s).sort().reverse();
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });
}

function daysSince(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.floor((t.getTime() - d.getTime()) / 86_400_000);
}

type Status = "completed" | "overdue" | "pending";

function rowStatus(e: ComputedEntry): Status {
  if (e.deposit_date) return "completed";
  if (daysSince(e.date) > 2) return "overdue";
  return "pending";
}

// ── component ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [allEntries, setAllEntries]       = useState<DailyEntry[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [depositInputs, setDepositInputs] = useState<Record<string, { amount: string; date: string }>>({});
  const [saving, setSaving]               = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editEntry, setEditEntry]         = useState<ComputedEntry | null>(null);
  const [editInputs, setEditInputs]       = useState({
    date: "", registered_deeds: "", amount_received: "",
    amount_deposited: "", deposit_date: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const data: DailyEntry[] = await fetch("/api/entries").then((r) => r.json());
    setAllEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const computed     = computeBalances(allEntries);
  const monthEntries = selectedMonth
    ? computed.filter((e) => e.date.startsWith(selectedMonth))
    : computed;
  const months       = getMonths(allEntries);

  const pendingCount   = monthEntries.filter((e) => !e.deposit_date).length;
  const overdueCount   = monthEntries.filter((e) => rowStatus(e) === "overdue").length;
  const completedCount = monthEntries.filter((e) => !!e.deposit_date).length;

  const totals = monthEntries.reduce(
    (a, e) => ({
      deeds:     a.deeds     + e.registered_deeds,
      received:  a.received  + e.amount_received,
      deposited: a.deposited + (e.amount_deposited ?? 0),
    }),
    { deeds: 0, received: 0, deposited: 0 }
  );

  // ── actions ───────────────────────────────────────────────────────────────

  const saveDeposit = async (entry: ComputedEntry) => {
    const inp = depositInputs[entry.id];
    if (!inp?.amount || !inp?.date) return;
    setSaving(entry.id);
    await fetch(`/api/entries/${entry.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_deposited: parseFloat(inp.amount.replace(/,/g, "")),
        deposit_date: inp.date,
      }),
    });
    setSaving(null);
    setDepositInputs((p) => { const n = { ...p }; delete n[entry.id]; return n; });
    await load();
  };

  const clearDeposit = async (e: ComputedEntry) => {
    await fetch(`/api/entries/${e.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_deposited: null, deposit_date: null }),
    });
    await load();
  };

  const deleteEntry = async (id: string) => {
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    await load();
  };

  const saveEdit = async () => {
    if (!editEntry) return;
    const d  = editInputs.date;
    const rd = parseInt(editInputs.registered_deeds);
    const ar = parseFloat(editInputs.amount_received.replace(/,/g, ""));
    if (!d || isNaN(rd) || isNaN(ar)) return;
    const adRaw = editInputs.amount_deposited.replace(/,/g, "");
    const ad    = adRaw !== "" ? parseFloat(adRaw) : null;
    const dd    = editInputs.deposit_date || null;
    await fetch(`/api/entries/${editEntry.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: d, registered_deeds: rd, amount_received: ar, amount_deposited: ad, deposit_date: dd }),
    });
    setEditEntry(null);
    await load();
  };

  const buildPrintUrl = (ids?: string[]) => {
    // If no month is selected ("All"), default to current calendar month for printing
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const printMonth = selectedMonth || currentMonth;
    const label      = monthLabel(printMonth).toUpperCase();
    const params     = new URLSearchParams({ heading: label });
    if (ids?.length) params.set("ids", ids.join(","));
    else             params.set("month", printMonth);
    return `/print?${params.toString()}`;
  };

  const toggleSelect = (id: string) =>
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected(selected.size === monthEntries.length ? new Set() : new Set(monthEntries.map((e) => e.id)));

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: "#f1f5f9", fontFamily: "Arial, sans-serif" }}>

      {/* ── Header ── */}
      <header style={{
        background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 60%, #3b82f6 100%)",
        padding: "0 24px",
        display: "flex", alignItems: "center", gap: "16px",
        height: "60px", boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
      }}>
        <Link href="/" style={{ color: "#a5b4fc", fontSize: "13px", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          ← Home
        </Link>

        <div style={{ color: "white", fontSize: "17px", fontWeight: "700", flex: 1, letterSpacing: "0.3px" }}>
          Admin Panel
          <span style={{ color: "#bfdbfe", fontSize: "12px", fontWeight: "400", marginLeft: "10px" }}>
            District Information Technology Society · Tehsil Nilokheri
          </span>
        </div>

        {/* Month selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#a5b4fc", fontSize: "12px" }}>Month:</span>
          <select
            value={selectedMonth}
            onChange={(e) => { setSelectedMonth(e.target.value); setSelected(new Set()); }}
            style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(191,219,254,0.5)", borderRadius: "8px", padding: "5px 10px", fontSize: "13px", cursor: "pointer" }}
          >
            <option value="" style={{ background: "#1e1b4b" }}>All Months</option>
            {months.map((m) => (
              <option key={m} value={m} style={{ background: "#1e1b4b" }}>{monthLabel(m)}</option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <button
          onClick={() => window.open(buildPrintUrl(), "_blank")}
          disabled={monthEntries.length === 0}
          style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: "600", cursor: "pointer", backdropFilter: "blur(4px)", opacity: monthEntries.length === 0 ? 0.4 : 1 }}
        >
          🖨 Print Month
        </button>

        <button
          onClick={() => window.open(buildPrintUrl(Array.from(selected)), "_blank")}
          disabled={selected.size === 0}
          style={{ background: selected.size > 0 ? "#f59e0b" : "rgba(255,255,255,0.08)", color: selected.size > 0 ? "#1c1917" : "rgba(255,255,255,0.4)", border: "none", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: "600", cursor: selected.size > 0 ? "pointer" : "default", transition: "all 0.2s" }}
        >
          🖨 Print Selected {selected.size > 0 && `(${selected.size})`}
        </button>

        <Link href="/upload" style={{ background: "#10b981", color: "white", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: "600", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}>
          + Upload
        </Link>
      </header>

      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "24px 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8", fontSize: "16px" }}>Loading…</div>
        ) : allEntries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>📂</div>
            <p style={{ color: "#64748b", marginBottom: "20px" }}>No entries yet. Upload your first Excel file.</p>
            <Link href="/upload" style={{ background: "#4f46e5", color: "white", padding: "10px 24px", borderRadius: "10px", textDecoration: "none", fontSize: "14px", fontWeight: "600" }}>Upload Excel →</Link>
          </div>
        ) : (
          <>
            {/* ── Stat cards ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "14px", marginBottom: "20px" }}>
              {[
                { label: "Working Days",   value: monthEntries.length, color: "#4f46e5", bg: "#eef2ff", icon: "📅" },
                { label: "Total Deeds",    value: fmt(totals.deeds),   color: "#0f172a", bg: "#f8fafc", icon: "📋" },
                { label: "Amt Received",   value: `₹${fmt(totals.received)}`, color: "#0369a1", bg: "#e0f2fe", icon: "💰" },
                { label: overdueCount > 0 ? `Pending (${overdueCount} overdue)` : "Pending", value: pendingCount, color: pendingCount > 0 ? "#dc2626" : "#64748b", bg: pendingCount > 0 ? "#fef2f2" : "#f8fafc", icon: "⏳" },
                { label: "Completed",      value: completedCount,      color: "#059669", bg: "#ecfdf5", icon: "✅" },
              ].map(({ label, value, color, bg, icon }) => (
                <div key={label} style={{ background: "white", borderRadius: "14px", padding: "18px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div>
                    <div style={{ fontSize: "20px", fontWeight: "700", color, lineHeight: 1.2 }}>{value}</div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px", lineHeight: 1.3 }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Legend ── */}
            <div style={{ display: "flex", gap: "18px", marginBottom: "12px", fontSize: "12px", color: "#64748b", alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: "white", border: "1.5px solid #e2e8f0", display: "inline-block" }}></span> Pending
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#fef2f2", border: "1.5px solid #fca5a5", display: "inline-block" }}></span> Overdue (&gt;2 days)
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: "#f0fdf4", border: "1.5px solid #86efac", display: "inline-block" }}></span> Completed
              </span>
            </div>

            {/* ── Table ── */}
            <div style={{ background: "white", borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                  <thead>
                    <tr style={{ background: "linear-gradient(135deg, #1d4ed8, #2563eb)" }}>
                      <th style={TH_S}><input type="checkbox" checked={monthEntries.length > 0 && monthEntries.every((e) => selected.has(e.id))} onChange={toggleAll} style={{ cursor: "pointer" }} /></th>
                      {["Sr.", "Date", "Reg. Deed", "Received", "Last Bal.", "Total", "Deposited", "Dep. Date", "Balance", "Actions"].map((h) => (
                        <th key={h} style={TH_S}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthEntries.map((e, i) => {
                      const st  = rowStatus(e);
                      const inp = depositInputs[e.id] ?? { amount: "", date: "" };
                      const rowBg    = st === "completed" ? "#f0fdf4" : st === "overdue" ? "#fef2f2" : i % 2 === 1 ? "#f8fafc" : "white";
                      const leftBorder = st === "completed" ? "3px solid #10b981" : st === "overdue" ? "3px solid #ef4444" : "3px solid transparent";

                      return (
                        <tr key={e.id} style={{ background: rowBg, borderLeft: leftBorder, transition: "background 0.15s" }}>

                          <td style={TD_S}><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} style={{ cursor: "pointer" }} /></td>

                          <td style={{ ...TD_S, color: "#94a3b8", fontSize: "12px" }}>{e.sr_no}</td>

                          <td style={{ ...TD_S, fontWeight: "600", color: "#0f172a", whiteSpace: "nowrap" }}>
                            {fmtDate(e.date)}
                            {st === "overdue" && (
                              <span style={{ marginLeft: "6px", background: "#ef4444", color: "white", fontSize: "9px", fontWeight: "700", padding: "1px 5px", borderRadius: "4px", letterSpacing: "0.5px" }}>OVERDUE</span>
                            )}
                          </td>

                          <td style={{ ...TD_S, textAlign: "center" }}>{e.registered_deeds}</td>
                          <td style={{ ...TD_S, textAlign: "center", color: st === "completed" ? "#059669" : "#0f172a", fontWeight: "500" }}>{fmt(e.amount_received)}</td>
                          <td style={{ ...TD_S, textAlign: "center", color: "#94a3b8" }}>{fmt(e.last_balance)}</td>
                          <td style={{ ...TD_S, textAlign: "center", fontWeight: "600" }}>{fmt(e.total_amount)}</td>

                          {/* Deposited — input or static */}
                          <td style={{ ...TD_S, padding: "6px 8px" }}>
                            {st === "completed" ? (
                              <span style={{ display: "block", textAlign: "center", color: "#4f46e5", fontWeight: "600" }}>{fmt(e.amount_deposited)}</span>
                            ) : (
                              <input
                                type="number" placeholder="Amount"
                                value={inp.amount}
                                onChange={(ev) => setDepositInputs((p) => ({ ...p, [e.id]: { ...inp, amount: ev.target.value } }))}
                                style={{ width: "100px", border: `1px solid ${st === "overdue" ? "#fca5a5" : "#e2e8f0"}`, borderRadius: "7px", padding: "5px 8px", fontSize: "12px", background: st === "overdue" ? "#fff5f5" : "white", outline: "none" }}
                              />
                            )}
                          </td>

                          {/* Dep. Date — input or static */}
                          <td style={{ ...TD_S, padding: "6px 8px" }}>
                            {st === "completed" ? (
                              <span style={{ display: "block", textAlign: "center", color: "#475569", fontSize: "12px" }}>{e.deposit_date ? fmtDate(e.deposit_date) : "—"}</span>
                            ) : (
                              <input
                                type="date"
                                value={inp.date}
                                min={e.date}
                                onChange={(ev) => setDepositInputs((p) => ({ ...p, [e.id]: { ...inp, date: ev.target.value } }))}
                                style={{ border: `1px solid ${st === "overdue" ? "#fca5a5" : "#e2e8f0"}`, borderRadius: "7px", padding: "5px 8px", fontSize: "12px", background: st === "overdue" ? "#fff5f5" : "white", outline: "none" }}
                              />
                            )}
                          </td>

                          {/* Balance */}
                          <td style={{ ...TD_S, textAlign: "center", fontWeight: "700", color: st === "completed" ? "#059669" : st === "overdue" ? "#dc2626" : "#f59e0b" }}>
                            {fmt(e.balance)}
                          </td>

                          {/* Actions */}
                          <td style={{ ...TD_S, whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                              {st !== "completed" && (
                                <button onClick={() => saveDeposit(e)} disabled={!inp.amount || !inp.date || saving === e.id}
                                  style={{ background: !inp.amount || !inp.date ? "#e2e8f0" : "#4f46e5", color: !inp.amount || !inp.date ? "#94a3b8" : "white", border: "none", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "600", cursor: !inp.amount || !inp.date ? "default" : "pointer" }}>
                                  {saving === e.id ? "…" : "Save"}
                                </button>
                              )}
                              {st === "completed" && (
                                <button onClick={() => clearDeposit(e)}
                                  style={{ background: "#fef3c7", color: "#b45309", border: "none", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>
                                  Undo
                                </button>
                              )}
                              <button onClick={() => { setEditEntry(e); setEditInputs({ date: e.date, registered_deeds: String(e.registered_deeds), amount_received: String(e.amount_received), amount_deposited: e.amount_deposited != null ? String(e.amount_deposited) : "", deposit_date: e.deposit_date ?? "" }); }}
                                style={{ background: "#f1f5f9", color: "#475569", border: "none", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>
                                Edit
                              </button>
                              <button onClick={() => setDeleteConfirm(e.id)}
                                style={{ background: "#fff1f2", color: "#e11d48", border: "none", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0" }}>
                      <td colSpan={3} style={{ ...TD_S, fontWeight: "700", color: "#0f172a", textAlign: "center" }}>Total</td>
                      <td style={{ ...TD_S, textAlign: "center", fontWeight: "700" }}>{fmt(totals.deeds)}</td>
                      <td style={{ ...TD_S, textAlign: "center", fontWeight: "700", color: "#0369a1" }}>₹{fmt(totals.received)}</td>
                      <td style={TD_S}></td>
                      <td style={TD_S}></td>
                      <td style={{ ...TD_S, textAlign: "center", fontWeight: "700", color: "#4f46e5" }}>₹{fmt(totals.deposited)}</td>
                      <td style={TD_S}></td>
                      <td style={{ ...TD_S, textAlign: "center", fontWeight: "700", color: "#dc2626" }}>₹{fmt(totals.received - totals.deposited)}</td>
                      <td style={TD_S}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── Edit Modal ── */}
      {editEntry && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "white", borderRadius: "18px", boxShadow: "0 25px 60px rgba(0,0,0,0.25)", padding: "28px", width: "100%", maxWidth: "400px" }}>
            <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#0f172a", marginBottom: "4px" }}>Edit Entry</h3>
            <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "20px" }}>Leave deposit fields blank to keep entry pending.</p>

            <div style={{ marginBottom: "14px" }}>
              <p style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "10px" }}>Entry Details</p>
              {[
                { label: "Date", key: "date", type: "date" },
                { label: "Registered Deeds", key: "registered_deeds", type: "number" },
                { label: "Amount Received (₹)", key: "amount_received", type: "number" },
              ].map(({ label, key, type }) => (
                <div key={key} style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "4px" }}>{label}</label>
                  <input type={type} value={editInputs[key as keyof typeof editInputs]}
                    onChange={(e) => setEditInputs((p) => ({ ...p, [key]: e.target.value }))}
                    style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: "9px", padding: "9px 12px", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              ))}
            </div>

            <div style={{ background: "#f0f9ff", borderRadius: "12px", padding: "14px", marginBottom: "20px" }}>
              <p style={{ fontSize: "11px", fontWeight: "700", color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "10px" }}>
                Deposit Details <span style={{ fontWeight: "400", color: "#94a3b8" }}>(optional)</span>
              </p>
              {[
                { label: "Amount Deposited (₹)", key: "amount_deposited", type: "number", ph: "Leave blank if not deposited" },
                { label: "Deposit Date",          key: "deposit_date",     type: "date",   ph: "" },
              ].map(({ label, key, type, ph }) => (
                <div key={key} style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px", color: "#0369a1", display: "block", marginBottom: "4px" }}>{label}</label>
                  <input type={type} placeholder={ph} value={editInputs[key as keyof typeof editInputs]}
                    onChange={(e) => setEditInputs((p) => ({ ...p, [key]: e.target.value }))}
                    style={{ width: "100%", border: "1.5px solid #bae6fd", borderRadius: "9px", padding: "9px 12px", fontSize: "14px", background: "white", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setEditEntry(null)}
                style={{ flex: 1, border: "1.5px solid #e2e8f0", background: "white", color: "#64748b", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}>
                Cancel
              </button>
              <button onClick={saveEdit}
                style={{ flex: 1, background: "linear-gradient(135deg, #1d4ed8, #2563eb)", color: "white", border: "none", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "white", borderRadius: "18px", boxShadow: "0 25px 60px rgba(0,0,0,0.25)", padding: "32px 28px", width: "100%", maxWidth: "320px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#0f172a", marginBottom: "6px" }}>Delete Entry?</h3>
            <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "24px" }}>This action cannot be undone.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteConfirm(null)}
                style={{ flex: 1, border: "1.5px solid #e2e8f0", background: "white", color: "#64748b", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}>
                Cancel
              </button>
              <button onClick={() => deleteEntry(deleteConfirm)}
                style={{ flex: 1, background: "#dc2626", color: "white", border: "none", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── shared cell styles ────────────────────────────────────────────────────────

const TH_S: React.CSSProperties = {
  padding: "12px 10px",
  fontSize: "11px",
  fontWeight: "700",
  color: "#bfdbfe",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
  textAlign: "center",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

const TD_S: React.CSSProperties = {
  padding: "10px 10px",
  fontSize: "13px",
  color: "#1e293b",
  borderBottom: "1px solid #f1f5f9",
  textAlign: "center",
};
