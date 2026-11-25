// Streaming CSV reader (RFC 4180 quotes). nflverse files can be 50-80 MB, so
// rows are handed to a callback one at a time instead of held in memory.

import { fetchRaw } from "./http.js";

export type Row = Record<string, string>;

export function createCsvParser(onRow: (row: Row) => void) {
  let header: string[] | null = null;
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let pendingQuote = false; // saw a quote inside a quoted field; next char decides

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    if (!header) {
      header = record.map((h) => h.replace(/^﻿/, ""));
    } else if (!(record.length === 1 && record[0] === "")) {
      const row: Row = {};
      for (let i = 0; i < header.length; i++) row[header[i]] = record[i] ?? "";
      onRow(row);
    }
    record = [];
  };

  return {
    push(chunk: string) {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          inQuotes = false;
        }
        if (inQuotes) {
          if (c === '"') pendingQuote = true;
          else field += c;
          continue;
        }
        if (c === '"') inQuotes = true;
        else if (c === ",") endField();
        else if (c === "\n") endRecord();
        else if (c !== "\r") field += c;
      }
    },
    end() {
      if (pendingQuote) {
        pendingQuote = false;
        inQuotes = false;
      }
      if (field !== "" || record.length > 0) endRecord();
    },
  };
}

export function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  const p = createCsvParser((r) => rows.push(r));
  p.push(text);
  p.end();
  return rows;
}

/** Download a CSV (optionally .gz) and stream each row to `onRow`. */
export async function streamCsv(url: string, onRow: (row: Row) => void, timeoutMs = 120_000) {
  const res = await fetchRaw(url, timeoutMs);
  if (!res.body) throw new Error(`Empty body from ${url}`);
  let stream: ReadableStream<Uint8Array> = res.body;
  if (url.endsWith(".gz")) {
    stream = stream.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  const parser = createCsvParser(onRow);
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}

export const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
