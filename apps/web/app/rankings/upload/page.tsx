"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";

type RawRow = Record<string, string>;

type Mapping = {
  nameCol: string;
  nameCombined: boolean; // name column also contains team/bye, e.g. "Jahmyr Gibbs   DET (6)"
  positionCol: string;
  positionCombined: boolean; // position column has a rank suffix, e.g. "RB1"
  teamCol: string; // "" if none / combined into name
  byeCol: string; // "" if none / combined into name
  rankCol: string;
  adpCol: string; // "" if none
};

const EMPTY_MAPPING: Mapping = {
  nameCol: "",
  nameCombined: false,
  positionCol: "",
  positionCombined: false,
  teamCol: "",
  byeCol: "",
  rankCol: "",
  adpCol: "",
};

function extractNameTeamBye(raw: string) {
  const byeMatch = raw.match(/\((\d{1,2})\)\s*$/);
  const byeWeek = byeMatch ? Number(byeMatch[1]) : null;
  const withoutBye = raw.replace(/\(\d{1,2}\)\s*$/, "").trim();
  const teamMatch = withoutBye.match(/\s([A-Z]{2,4})\s*$/);
  const team = teamMatch ? teamMatch[1] : null;
  const name = team ? withoutBye.slice(0, withoutBye.length - team.length).trim() : withoutBye;
  return { name, team, byeWeek };
}

function extractPositionRank(raw: string) {
  const match = raw.match(/^([A-Za-z]+)(\d+)?$/);
  if (!match) return { position: raw.trim().toUpperCase(), posRank: null as number | null };
  return { position: match[1].toUpperCase(), posRank: match[2] ? Number(match[2]) : null };
}

export default function RankingsUploadPage() {
  const router = useRouter();

  const [sourceName, setSourceName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ total: number; matched: number; unmatched: number } | null>(null);

  function loadRowsFromSheet(wb: XLSX.WorkBook, sheetName: string) {
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
    if (json.length === 0) {
      setError("That sheet doesn't look like it has any rows.");
      return;
    }
    setHeaders(Object.keys(json[0]));
    setRows(json.map((r) => {
      const stringified: RawRow = {};
      for (const key of Object.keys(r)) stringified[key] = String(r[key] ?? "");
      return stringified;
    }));
    setError(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setMapping(EMPTY_MAPPING);

    if (!sourceName) {
      setSourceName(file.name.replace(/\.(csv|xlsx|xls)$/i, ""));
    }

    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      const parsed = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true });
      if (!parsed.data || parsed.data.length === 0) {
        setError("Couldn't find any rows in that CSV.");
        return;
      }
      setHeaders(parsed.meta.fields ?? []);
      setRows(parsed.data);
      setSheetNames([]);
      setWorkbook(null);
    } else {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0];
      setSelectedSheet(firstSheet);
      loadRowsFromSheet(wb, firstSheet);
    }
  }

  function handleSheetChange(sheetName: string) {
    setSelectedSheet(sheetName);
    if (workbook) loadRowsFromSheet(workbook, sheetName);
  }

  function buildParsedRows() {
    return rows.map((row) => {
      let name = mapping.nameCol ? row[mapping.nameCol] ?? "" : "";
      let team: string | null = mapping.teamCol ? row[mapping.teamCol] ?? null : null;
      let byeWeek: number | null = mapping.byeCol ? Number(row[mapping.byeCol]) || null : null;

      if (mapping.nameCombined && name) {
        const extracted = extractNameTeamBye(name);
        name = extracted.name;
        team = team ?? extracted.team;
        byeWeek = byeWeek ?? extracted.byeWeek;
      }

      let position: string | null = mapping.positionCol ? row[mapping.positionCol] ?? null : null;
      if (mapping.positionCombined && position) {
        position = extractPositionRank(position).position;
      }

      const rank = mapping.rankCol ? Number(row[mapping.rankCol]) || null : null;
      const adp = mapping.adpCol ? Number(row[mapping.adpCol]) || null : null;

      return {
        rank,
        adp,
        playerNameRaw: mapping.nameCol ? row[mapping.nameCol] ?? "" : "",
        playerNameClean: name.trim(),
        position: position ? position.trim().toUpperCase() : null,
        team: team ? team.trim().toUpperCase() : null,
        byeWeek,
      };
    }).filter((r) => r.playerNameClean.length > 0);
  }

  const preview = mapping.nameCol ? buildParsedRows().slice(0, 5) : [];

  async function handleSubmit() {
    if (!sourceName.trim()) {
      setError("Give this ranking source a name first.");
      return;
    }
    if (!mapping.nameCol) {
      setError("You need to map at least the player name column.");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const parsedRows = buildParsedRows();
      const res = await fetch("/api/rankings/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sourceName.trim(), rows: parsedRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");

      setResult({ total: data.total, matched: data.matched, unmatched: data.unmatched });
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <button
        onClick={() => router.push("/rankings")}
        className="text-sm text-white/50 hover:underline"
      >
        &larr; Back to rankings
      </button>

      <h1 className="mb-1 mt-3 text-xl font-semibold">Upload rankings</h1>
      <p className="mb-6 text-sm text-white/60">
        Upload a CSV or Excel file from any source. You'll map the columns
        yourself, so it doesn't matter how the source formats things.
      </p>

      <div className="mb-6">
        <label className="mb-1 block text-sm text-white/60">
          Name this ranking source
        </label>
        <input
          type="text"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="e.g. FantasyPros ADP"
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
      </div>

      <div className="mb-6">
        <label className="mb-1 block text-sm text-white/60">File (CSV or Excel)</label>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFile}
          className="block w-full text-sm text-white/70"
        />
      </div>

      {sheetNames.length > 1 && (
        <div className="mb-6">
          <label className="mb-1 block text-sm text-white/60">Sheet</label>
          <select
            value={selectedSheet}
            onChange={(e) => handleSheetChange(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            {sheetNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-white/40">
            Only sheets with one row per player work here — a sheet laid out
            as side-by-side tables per position won't parse correctly.
          </p>
        </div>
      )}

      {headers.length > 0 && (
        <div className="mb-6 space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-white/50">
            Map your columns
          </h2>

          <ColumnSelect label="Player name" headers={headers} value={mapping.nameCol}
            onChange={(v) => setMapping((m) => ({ ...m, nameCol: v }))} />
          <label className="flex items-center gap-2 text-sm text-white/60">
            <input type="checkbox" checked={mapping.nameCombined}
              onChange={(e) => setMapping((m) => ({ ...m, nameCombined: e.target.checked }))} />
            This column also has team + bye week jammed in, like "Jahmyr Gibbs&nbsp;&nbsp;DET (6)"
          </label>

          <ColumnSelect label="Position" headers={headers} value={mapping.positionCol}
            onChange={(v) => setMapping((m) => ({ ...m, positionCol: v }))} />
          <label className="flex items-center gap-2 text-sm text-white/60">
            <input type="checkbox" checked={mapping.positionCombined}
              onChange={(e) => setMapping((m) => ({ ...m, positionCombined: e.target.checked }))} />
            This column has a rank number stuck on the end, like "RB1"
          </label>

          {!mapping.nameCombined && (
            <>
              <ColumnSelect label="Team (optional)" headers={headers} value={mapping.teamCol} allowNone
                onChange={(v) => setMapping((m) => ({ ...m, teamCol: v }))} />
              <ColumnSelect label="Bye week (optional)" headers={headers} value={mapping.byeCol} allowNone
                onChange={(v) => setMapping((m) => ({ ...m, byeCol: v }))} />
            </>
          )}

          <ColumnSelect label="Rank" headers={headers} value={mapping.rankCol} allowNone
            onChange={(v) => setMapping((m) => ({ ...m, rankCol: v }))} />
          <ColumnSelect label="ADP (optional, if different from rank)" headers={headers} value={mapping.adpCol} allowNone
            onChange={(v) => setMapping((m) => ({ ...m, adpCol: v }))} />
        </div>
      )}

      {preview.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-white/50">
            Preview
          </h2>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="px-3 py-2">Rank</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Pos</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Bye</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-white/10">
                    <td className="px-3 py-2">{r.rank ?? "—"}</td>
                    <td className="px-3 py-2">{r.playerNameClean}</td>
                    <td className="px-3 py-2">{r.position ?? "—"}</td>
                    <td className="px-3 py-2">{r.team ?? "—"}</td>
                    <td className="px-3 py-2">{r.byeWeek ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-400">Imported successfully.</p>
          <p className="text-white/70">
            {result.matched} of {result.total} players matched to Sleeper's
            database automatically.
            {result.unmatched > 0 &&
              ` ${result.unmatched} didn't match — usually a spelling difference or a very deep bench player. They're still saved, just without a Sleeper ID linked yet.`}
          </p>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={uploading || headers.length === 0}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {uploading ? "Uploading and matching players..." : "Save ranking source"}
      </button>
    </main>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  headers: string[];
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-white/60">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
      >
        {allowNone && <option value="">— none —</option>}
        {!allowNone && <option value="">Select a column...</option>}
        {headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </div>
  );
}
