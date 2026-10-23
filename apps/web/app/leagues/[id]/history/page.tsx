import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SyncHistoryButton from "./sync-button";

export default async function LeagueHistoryPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  const { data: seasons } = await supabase
    .from("league_history_seasons")
    .select("id, season, sleeper_league_id")
    .eq("league_id", league.id)
    .order("season", { ascending: false });

  const seasonIds = (seasons ?? []).map((s) => s.id);

  const { data: allPicks } =
    seasonIds.length > 0
      ? await supabase
          .from("draft_picks")
          .select("history_season_id, round, sleeper_user_id, manager_name, player_position, is_keeper")
          .in("history_season_id", seasonIds)
      : { data: [] };

  const { data: allStandings } =
    seasonIds.length > 0
      ? await supabase
          .from("season_standings")
          .select("history_season_id, manager_name, wins, losses, ties, points_for, regular_season_rank")
          .in("history_season_id", seasonIds)
          .order("regular_season_rank", { ascending: true })
      : { data: [] };

  // Build a per-manager early-round (rounds 1–3) position breakdown across all synced seasons.
  // Grouped by sleeper_user_id (a stable ID for the person), not manager_name — a manager's
  // team name can change year to year, which would otherwise split one person into several rows.
  // The most recent season's name is used as the display label for that person.
  const seasonOrderById = new Map((seasons ?? []).map((s, i) => [s.id, i])); // 0 = most recent
  const tendencies: Record<string, Record<string, number>> = {};
  const displayNameByKey: Record<string, { name: string; seasonRank: number }> = {};

  for (const pick of allPicks ?? []) {
    const key = pick.sleeper_user_id ?? pick.manager_name;

    const seasonRank = seasonOrderById.get(pick.history_season_id) ?? 999;
    if (
      !displayNameByKey[key] ||
      seasonRank < displayNameByKey[key].seasonRank
    ) {
      displayNameByKey[key] = { name: pick.manager_name, seasonRank };
    }

    if (pick.round > 3) continue;
    const pos = pick.player_position ?? "Unknown";
    tendencies[key] ??= {};
    tendencies[key][pos] = (tendencies[key][pos] ?? 0) + 1;
  }
  const positionSet = new Set<string>();
  Object.values(tendencies).forEach((row) =>
    Object.keys(row).forEach((pos) => positionSet.add(pos))
  );
  const positions = Array.from(positionSet).sort();

  const seasonsById = new Map((seasons ?? []).map((s) => [s.id, s.season]));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href={`/leagues/${league.id}`}
        className="text-sm text-white/50 hover:underline"
      >
        &larr; Back to league
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name} — History</h1>
      <p className="mb-6 text-sm text-white/60">
        Pull every past draft and season record from Sleeper. This is the
        data everything else in Fantasy Draft Labs will build on.
      </p>

      <div className="mb-8">
        <SyncHistoryButton leagueId={league.id} />
      </div>

      {(!seasons || seasons.length === 0) && (
        <p className="text-sm text-white/50">
          No history synced yet — click the button above to pull it from
          Sleeper.
        </p>
      )}

      {seasons && seasons.length > 0 && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-white/50">
              Synced seasons
            </h2>
            <div className="flex flex-wrap gap-2">
              {seasons.map((s) => (
                <span
                  key={s.id}
                  className="rounded-md bg-white/5 px-3 py-1.5 text-sm"
                >
                  {s.season}
                </span>
              ))}
            </div>
          </section>

          {positions.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-white/50">
                Early-round tendencies (rounds 1–3, all synced seasons)
              </h2>
              <p className="mb-3 text-xs text-white/40">
                How many times each manager took each position early. A
                simple starting signal — the real behavior modeling comes
                once we run simulations against this.
              </p>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-3 py-2">Manager</th>
                      {positions.map((pos) => (
                        <th key={pos} className="px-3 py-2">
                          {pos}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(tendencies).map(([key, counts]) => (
                      <tr key={key} className="border-t border-white/10">
                        <td className="px-3 py-2 font-medium">
                          {displayNameByKey[key]?.name ?? key}
                        </td>
                        {positions.map((pos) => (
                          <td key={pos} className="px-3 py-2 text-white/70">
                            {counts[pos] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-white/50">
              Season standings (regular season record)
            </h2>
            <p className="mb-3 text-xs text-white/40">
              Ranked by regular-season wins, then points — this is not
              necessarily final playoff placement, which Sleeper doesn't
              expose directly.
            </p>
            {(seasons ?? []).map((s) => {
              const rows = (allStandings ?? []).filter(
                (row) => row.history_season_id === s.id
              );
              if (rows.length === 0) return null;
              return (
                <div key={s.id} className="mb-4">
                  <h3 className="mb-2 text-sm font-medium">{s.season}</h3>
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Manager</th>
                          <th className="px-3 py-2">Record</th>
                          <th className="px-3 py-2">Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={`${row.history_season_id}-${row.manager_name}`}
                            className="border-t border-white/10"
                          >
                            <td className="px-3 py-2">{row.regular_season_rank}</td>
                            <td className="px-3 py-2">{row.manager_name}</td>
                            <td className="px-3 py-2 text-white/70">
                              {row.wins}-{row.losses}
                              {row.ties ? `-${row.ties}` : ""}
                            </td>
                            <td className="px-3 py-2 text-white/70">
                              {Number(row.points_for).toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
