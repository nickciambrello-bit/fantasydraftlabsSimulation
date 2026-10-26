import { parse } from "csv-parse/sync";
import type { CsvRow } from "./values";

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "fantasy-labs-ingest" } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.text();
}

export function parseCsv(text: string): CsvRow[] {
  return parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true }) as CsvRow[];
}

/** Returns null on 404, so a season that has not started yet is skipped rather than fatal. */
export async function fetchCsv(url: string, { optional = false } = {}): Promise<CsvRow[] | null> {
  const res = await fetch(url, { headers: { "user-agent": "fantasy-labs-ingest" } });
  if (optional && res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return parseCsv(await res.text());
}
