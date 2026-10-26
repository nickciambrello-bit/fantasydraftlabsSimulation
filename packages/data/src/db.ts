import postgres from "postgres";

export type Sql = postgres.Sql<Record<string, unknown>>;

export function connect(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the Supabase Postgres connection string.");
  // prepare: false keeps this working through Supabase's transaction pooler.
  return postgres(url, { prepare: false, max: 4, onnotice: () => {} });
}

/**
 * Batched INSERT ... ON CONFLICT DO UPDATE. Column and table names come from
 * our own code (never user input), so building the SET clause as text is safe.
 */
export async function upsert<T extends Record<string, unknown>>(
  sql: Sql,
  table: string,
  rows: T[],
  conflictColumns: string[],
  {
    updateColumns,
    keepExistingWhenNull = [],
    batchSize = 1000,
  }: { updateColumns?: string[]; keepExistingWhenNull?: string[]; batchSize?: number } = {}
): Promise<number> {
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  const toUpdate = (updateColumns ?? columns).filter((c) => !conflictColumns.includes(c));
  const setClause = toUpdate
    .map((c) =>
      keepExistingWhenNull.includes(c)
        ? `"${c}" = coalesce(excluded."${c}", ${table}."${c}")`
        : `"${c}" = excluded."${c}"`
    )
    .join(", ");
  const touchesUpdatedAt = ["players", "games"].includes(table);
  const onConflict =
    `on conflict (${conflictColumns.map((c) => `"${c}"`).join(", ")}) do update set ${setClause}` +
    (touchesUpdatedAt ? `, "updated_at" = now()` : "");

  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await sql`insert into ${sql(table)} ${sql(batch as Record<string, unknown>[], columns)} ${sql.unsafe(onConflict)}`;
    written += batch.length;
  }
  return written;
}

export async function recordRun<T>(sql: Sql, source: string, detail: string, fn: () => Promise<number>): Promise<number> {
  const [run] = await sql`insert into ingest_runs (source, detail) values (${source}, ${detail}) returning id`;
  try {
    const rows = await fn();
    await sql`update ingest_runs set status = 'ok', rows_written = ${rows}, finished_at = now() where id = ${run.id}`;
    return rows;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`update ingest_runs set status = 'error', error = ${message}, finished_at = now() where id = ${run.id}`;
    throw err;
  }
}
