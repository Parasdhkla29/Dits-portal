"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { parseExcelFile } from "@/lib/excel-parser";
import type { ParsedExcelData } from "@/types";

function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function UploadPage() {
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedExcelData | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [existsWarning, setExistsWarning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setErrorMsg("Please upload an Excel file (.xlsx or .xls)");
      return;
    }
    setFileName(file.name);
    setErrorMsg("");
    setStatus("idle");
    setParsed(null);
    setExistsWarning(false);

    try {
      const buffer = await file.arrayBuffer();
      const data = parseExcelFile(buffer);
      if (!data.date) {
        setErrorMsg("Could not detect a date in this file. Check the Excel format.");
        return;
      }
      if (data.registeredDeeds === 0) {
        setErrorMsg("No deed entries detected. Check the Excel format.");
        return;
      }
      setParsed(data);

      // Check if entry for this date already exists
      const res = await fetch("/api/entries");
      const existing: { date: string }[] = await res.json();
      if (existing.some((e) => e.date === data.date)) {
        setExistsWarning(true);
      }
    } catch (e) {
      setErrorMsg("Failed to parse the Excel file. Ensure it matches the expected format.");
      console.error(e);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleSave = async () => {
    if (!parsed) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: parsed.date,
          registered_deeds: parsed.registeredDeeds,
          amount_received: parsed.amountReceived,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      setStatus("saved");
    } catch (e: unknown) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleReset = () => {
    setParsed(null);
    setFileName("");
    setStatus("idle");
    setErrorMsg("");
    setExistsWarning(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-800 text-white px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-blue-200 hover:text-white text-sm">
          ← Back
        </Link>
        <h1 className="text-lg font-semibold">Upload Daily Excel File</h1>
      </header>

      <main className="max-w-2xl mx-auto p-6">
        {status === "saved" ? (
          <div className="bg-green-50 border border-green-300 rounded-xl p-8 text-center">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-xl font-bold text-green-800 mb-1">Entry Saved!</h2>
            <p className="text-green-700 mb-1">
              <strong>{fmtDate(parsed!.date)}</strong> — {parsed!.registeredDeeds} deeds,
              ₹{fmt(parsed!.amountReceived)}
            </p>
            <p className="text-green-600 text-sm mb-6">
              {existsWarning ? "Existing entry was updated." : "New entry added to the admin panel."}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Upload Another
              </button>
              <Link
                href="/admin"
                className="bg-gray-700 text-white px-5 py-2 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Go to Admin Panel
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all mb-4 ${
                dragging
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileInput}
              />
              <div className="text-5xl mb-3">📄</div>
              <p className="text-gray-700 font-medium mb-1">
                {dragging ? "Drop the file here" : "Drop Excel file here"}
              </p>
              <p className="text-gray-400 text-sm">or click to browse &nbsp;·&nbsp; .xlsx / .xls</p>
            </div>

            {/* Error */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4 text-sm">
                {errorMsg}
              </div>
            )}

            {/* Preview Card */}
            {parsed && !errorMsg && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-4">
                  <span>📎</span>
                  <span className="font-medium text-gray-700 truncate">{fileName}</span>
                </div>

                {existsWarning && (
                  <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg p-3 text-sm mb-4">
                    ⚠️ An entry for this date already exists. Saving will update it.
                  </div>
                )}

                <h2 className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-3">
                  Detected Data
                </h2>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-blue-700">{fmtDate(parsed.date)}</div>
                    <div className="text-xs text-blue-500 mt-1">Date</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-700">{parsed.registeredDeeds}</div>
                    <div className="text-xs text-green-500 mt-1">Registered Deeds</div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-700">₹{fmt(parsed.amountReceived)}</div>
                    <div className="text-xs text-purple-500 mt-1">Amount Received</div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleReset}
                    className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={status === "saving"}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 font-medium"
                  >
                    {status === "saving" ? "Saving…" : existsWarning ? "Update Entry" : "Save Entry"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
