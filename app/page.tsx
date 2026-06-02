"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { parseExcelFile } from "@/lib/excel-parser";
import type { ParsedExcelData } from "@/types";

function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

type Stage = "idle" | "preview" | "saving" | "saved" | "error";

export default function Home() {
  const [stage, setStage]             = useState<Stage>("idle");
  const [dragging, setDragging]       = useState(false);
  const [parsed, setParsed]           = useState<ParsedExcelData | null>(null);
  const [fileName, setFileName]       = useState("");
  const [existsWarn, setExistsWarn]   = useState(false);
  const [errorMsg, setErrorMsg]       = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setErrorMsg("Please upload an Excel file (.xlsx or .xls)");
      setStage("error");
      return;
    }
    setFileName(file.name);
    setErrorMsg("");
    try {
      const buf  = await file.arrayBuffer();
      const data = parseExcelFile(buf);
      if (!data.date) {
        setErrorMsg("Could not detect a date in this file. Check the Excel format.");
        setStage("error"); return;
      }
      if (data.registeredDeeds === 0) {
        setErrorMsg("No deed entries detected. Check the Excel format.");
        setStage("error"); return;
      }
      setParsed(data);
      const existing: { date: string }[] = await fetch("/api/entries").then((r) => r.json());
      setExistsWarn(existing.some((e) => e.date === data.date));
      setStage("preview");
    } catch {
      setErrorMsg("Failed to parse the file. Ensure it matches the DITS Excel format.");
      setStage("error");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }, [processFile]);

  const handleSave = async () => {
    if (!parsed) return;
    setStage("saving");
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: parsed.date,
        registered_deeds: parsed.registeredDeeds,
        amount_received: parsed.amountReceived,
      }),
    });
    if (res.ok) { setStage("saved"); }
    else {
      const err = await res.json();
      setErrorMsg(err.error || "Save failed");
      setStage("error");
    }
  };

  const reset = () => {
    setStage("idle"); setParsed(null);
    setFileName(""); setErrorMsg(""); setExistsWarn(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #eff6ff 0%, #dbeafe 40%, #bfdbfe 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px", fontFamily: "Arial, sans-serif",
    }}>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "13px", fontWeight: "600", color: "#2563eb", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
          District Information Technology Society
        </div>
        <h1 style={{ fontSize: "32px", fontWeight: "800", color: "#1e3a8a", margin: 0 }}>Fee Management System</h1>
        <p style={{ fontSize: "15px", color: "#1e40af", marginTop: "6px" }}>Tehsil Nilokheri – DITS Fee Portal</p>
      </div>

      <div style={{ display: "flex", gap: "20px", width: "100%", maxWidth: "860px", flexWrap: "wrap", justifyContent: "center" }}>

        {/* ── Upload Card ── */}
        <div style={{
          background: "white", borderRadius: "20px", padding: "28px",
          boxShadow: "0 4px 24px rgba(37,99,235,0.12)", flex: "1 1 440px", minWidth: "300px",
          border: "1.5px solid #dbeafe",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>📁</div>
            <div>
              <h2 style={{ fontSize: "17px", fontWeight: "700", color: "#1e3a8a", margin: 0 }}>Upload Excel</h2>
              <p style={{ fontSize: "12px", color: "#1e40af", margin: 0 }}>Daily deed service charge file</p>
            </div>
          </div>

          {/* ── IDLE: drop zone ── */}
          {stage === "idle" && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? "#1d4ed8" : "#60a5fa"}`,
                  borderRadius: "14px", padding: "36px 20px", textAlign: "center",
                  background: dragging ? "#eff6ff" : "#f8fbff", cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleInput} />
                <div style={{ fontSize: "36px", marginBottom: "10px" }}>📄</div>
                <p style={{ fontSize: "15px", fontWeight: "600", color: "#1d4ed8", margin: "0 0 4px" }}>
                  {dragging ? "Drop it here!" : "Drop Excel file here"}
                </p>
                <p style={{ fontSize: "12px", color: "#1e40af", margin: 0 }}>or click to browse · .xlsx / .xls</p>
              </div>
            </>
          )}

          {/* ── ERROR ── */}
          {stage === "error" && (
            <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: "12px", padding: "16px", marginBottom: "12px" }}>
              <p style={{ color: "#be123c", fontSize: "13px", margin: "0 0 10px" }}>⚠️ {errorMsg}</p>
              <button onClick={reset} style={{ background: "#be123c", color: "white", border: "none", borderRadius: "8px", padding: "7px 16px", fontSize: "13px", cursor: "pointer" }}>Try Again</button>
            </div>
          )}

          {/* ── PREVIEW ── */}
          {stage === "preview" && parsed && (
            <div>
              {existsWarn && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px", padding: "10px 14px", fontSize: "12px", color: "#92400e", marginBottom: "14px" }}>
                  ⚠️ An entry for this date already exists — saving will update it.
                </div>
              )}
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>📎</span><span style={{ fontWeight: "500", color: "#334155" }}>{fileName}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "18px" }}>
                {[
                  { label: "Date",              value: fmtDate(parsed.date),          bg: "#eff6ff", color: "#1d4ed8" },
                  { label: "Registered Deeds",  value: String(parsed.registeredDeeds), bg: "#f0fdf4", color: "#15803d" },
                  { label: "Amount Received",    value: `₹${fmt(parsed.amountReceived)}`, bg: "#e0f2fe", color: "#0369a1" },
                ].map(({ label, value, bg, color }) => (
                  <div key={label} style={{ background: bg, borderRadius: "12px", padding: "14px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: "16px", fontWeight: "700", color }}>{value}</div>
                    <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "3px" }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={reset} style={{ flex: 1, border: "1.5px solid #e2e8f0", background: "white", color: "#64748b", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}>Cancel</button>
                <button onClick={handleSave} style={{ flex: 2, background: "linear-gradient(135deg, #1d4ed8, #2563eb)", color: "white", border: "none", borderRadius: "10px", padding: "10px", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}>
                  {existsWarn ? "Update Entry" : "Save Entry"}
                </button>
              </div>
            </div>
          )}

          {/* ── SAVING ── */}
          {stage === "saving" && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#3b82f6" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>⏳</div>
              <p style={{ fontSize: "14px", fontWeight: "600" }}>Saving entry…</p>
            </div>
          )}

          {/* ── SAVED ── */}
          {stage === "saved" && parsed && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: "40px", marginBottom: "10px" }}>✅</div>
              <p style={{ fontSize: "16px", fontWeight: "700", color: "#15803d", marginBottom: "4px" }}>Entry Saved!</p>
              <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "20px" }}>
                {fmtDate(parsed.date)} · {parsed.registeredDeeds} deeds · ₹{fmt(parsed.amountReceived)}
              </p>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <button onClick={reset} style={{ background: "#eff6ff", color: "#1d4ed8", border: "none", borderRadius: "9px", padding: "9px 18px", fontSize: "13px", cursor: "pointer", fontWeight: "600" }}>Upload Another</button>
                <Link href="/admin" style={{ background: "linear-gradient(135deg, #1d4ed8, #2563eb)", color: "white", borderRadius: "9px", padding: "9px 18px", fontSize: "13px", fontWeight: "600", textDecoration: "none" }}>Go to Admin →</Link>
              </div>
            </div>
          )}
        </div>

        {/* ── Admin Panel Card ── */}
        <Link href="/admin" style={{ textDecoration: "none", flex: "0 1 240px", minWidth: "220px" }}>
          <div style={{
            background: "white", borderRadius: "20px", padding: "28px", height: "100%",
            boxShadow: "0 4px 24px rgba(37,99,235,0.12)", cursor: "pointer",
            border: "1.5px solid #dbeafe", display: "flex", flexDirection: "column", justifyContent: "space-between",
            transition: "box-shadow 0.2s",
          }}>
            <div>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginBottom: "14px" }}>📊</div>
              <h2 style={{ fontSize: "17px", fontWeight: "700", color: "#1e3a8a", margin: "0 0 8px" }}>Admin Panel</h2>
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0, lineHeight: "1.5" }}>
                Manage entries, record deposits, and print monthly reports.
              </p>
            </div>
            <div style={{ marginTop: "24px", background: "linear-gradient(135deg, #1d4ed8, #2563eb)", color: "white", borderRadius: "10px", padding: "10px 16px", fontSize: "14px", fontWeight: "600", textAlign: "center" }}>
              Go to Admin →
            </div>
          </div>
        </Link>

      </div>

      <p style={{ fontSize: "11px", color: "#1e40af", marginTop: "32px" }}>
        District Information Technology Society
      </p>
    </div>
  );
}
