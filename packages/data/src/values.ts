// nflverse CSVs use "" and "NA" for missing values; every parser treats both as null.

export type CsvRow = Record<string, string>;

export function str(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === "" || t === "NA" ? null : t;
}

export function num(v: string | undefined): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function int(v: string | undefined): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export function bool(v: string | undefined): boolean | null {
  const s = str(v);
  if (s === null) return null;
  return s === "1" || s.toLowerCase() === "true";
}
