import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ImportSleeperDefaultButton from "./import-sleeper-default-button";
import DeleteRankingButton from "./delete-ranking-button";

export default async function RankingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sources } = await supabase
    .from("ranking_sources")
    .select("id, name, source_type, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const sourceIds = (sources ?? []).map((s) => s.id);

  const { data: entries } =
    sourceIds.length > 0
      ? await supabase
          .from("ranking_entries")
          .select("ranking_source_id, sleeper_player_id")
          .in("ranking_source_id", sourceIds)
      : { data: [] };

  const countsBySource: Record<string, { total: number; matched: number }> = {};
  for (const entry of entries ?? []) {
    countsBySource[entry.ranking_source_id] ??= { total: 0, matched: 0 };
    countsBySource[entry.ranking_source_id].total += 1;
    if (entry.sleeper_player_id) countsBySource[entry.ranking_source_id].matched += 1;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/dashboard" className="text-sm text-white/50 hover:underline">
        &larr; Back to dashboard
      </Link>

      <div className="mb-6 mt-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Rankings</h1>
          <p className="text-sm text-white/60">
            Any source you upload — plus Sleeper's own default — lives here.
          </p>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-3">
        <Link
          href="/rankings/upload"
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
        >
          Upload rankings
        </Link>
        <ImportSleeperDefaultButton />
      </div>

      {(!sources || sources.length === 0) && (
        <p className="text-sm text-white/50">
          No ranking sources yet. Upload a file or import Sleeper's default
          to get started.
        </p>
      )}

      <ul className="space-y-2">
        {(sources ?? []).map((source) => {
          const counts = countsBySource[source.id] ?? { total: 0, matched: 0 };
          return (
            <li
              key={source.id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  <Link href={`/rankings/${source.id}`} className="hover:underline">
                    {source.name}
                  </Link>
                </p>
                <p className="text-sm text-white/50">
                  {counts.total} players
                  {counts.total > 0 && ` · ${counts.matched} matched to Sleeper`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/rankings/${source.id}`}
                  className="text-sm text-white/50 hover:text-white/80 hover:underline"
                >
                  View
                </Link>
                <DeleteRankingButton sourceId={source.id} />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
