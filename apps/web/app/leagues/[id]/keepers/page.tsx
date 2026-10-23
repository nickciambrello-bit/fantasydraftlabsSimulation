import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  fetchSleeperRosters,
  fetchSleeperUsers,
  buildManagerNameLookup,
} from "@/lib/sleeper";
import { fetchSleeperPlayersLite, normalizePlayerName } from "@/lib/players";
import KeeperHub from "./keeper-hub";

function suggestRound(
  rule: string | null,
  adjustment: number,
  originalRound: number
): number | null {
  if (rule === "same_round") return originalRound;
  if (rule === "round_minus_n") return Math.max(1, originalRound - adjustment);
  if (rule === "flat_round") return adjustment;
  return null;
}

export default async function KeepersPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { source?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, sleeper_league_id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  const { data: settings } = await supabase
    .from("league_settings")
    .select("league_size, keeper_enabled, keeper_count, keeper_cost_rule, keeper_cost_adjustment")
    .eq("league_id", league.id)
    .single();

  const { data: rankingSources } = await supabase
    .from("ranking_sources")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const rankingSourceId = searchParams.source ?? rankingSources?.[0]?.id ?? "";

  // History for cost lookups (last drafted season) and manual quick-add.
  const { data: seasons } = await supabase
    .from("league_history_seasons")
    .select("id, season")
    .eq("league_id", league.id);

  const seasonIds = (seasons ?? []).map((s) => s.id);
  const seasonById = new Map((seasons ?? []).map((s) => [s.id, s.season]));

  const { data: allPicks } =
    seasonIds.length > 0
      ? await supabase
          .from("draft_picks")
          .select("round, sleeper_user_id, manager_name, player_name, player_position, history_season_id")
          .in("history_season_id", seasonIds)
      : { data: [] };

  let mostRecentSeasonId: string | null = null;
  let mostRecentSeason = "";
  for (const pick of allPicks ?? []) {
    const season = seasonById.get(pick.history_season_id) ?? "";
    if (season > mostRecentSeason) {
      mostRecentSeason = season;
      mostRecentSeasonId = pick.history_season_id;
    }
  }
  const lastDraftPicks = (allPicks ?? []).filter((p) => p.history_season_id === mostRecentSeasonId);

  // Manager list, built from ALL synced seasons so it's never empty even if
  // the most recent season is pre-draft.
  const managerMap = new Map<string, { key: string; name: string }>();
  for (const pick of allPicks ?? []) {
    const key = pick.sleeper_user_id ?? pick.manager_name;
    if (!managerMap.has(key)) managerMap.set(key, { key, name: pick.manager_name });
  }

  const { data: existingKeepers } = await supabase
    .from("keepers")
    .select("id, sleeper_user_id, manager_name, player_name, player_position, round")
    .eq("league_id", league.id)
    .order("round", { ascending: true });

  // Value candidates — only computed if we have both rankings and settings.
  let candidatesByManagerKey: Record<
    string,
    { playerName: string; position: string | null; costRound: number; valueRound: number; surplus: number }[]
  > = {};

  if (rankingSourceId && settings) {
    const { data: rankingRows } = await supabase
      .from("ranking_entries")
      .select("rank, adp, player_name_clean")
      .eq("ranking_source_id", rankingSourceId);

    const rankByName = new Map<string, number>();
    for (const r of rankingRows ?? []) {
      const sortKey = r.rank ?? r.adp;
      if (sortKey != null) rankByName.set(normalizePlayerName(r.player_name_clean), sortKey);
    }

    const [sleeperRosters, sleeperUsers, sleeperPlayers] = await Promise.all([
      fetchSleeperRosters(league.sleeper_league_id),
      fetchSleeperUsers(league.sleeper_league_id),
      fetchSleeperPlayersLite(),
    ]);

    const playerNameById = new Map(sleeperPlayers.map((p) => [p.player_id, p]));
    const managerLookup = buildManagerNameLookup(sleeperUsers, sleeperRosters);
    const leagueSize = settings.league_size;

    const costLookup = new Map<string, number>();
    for (const pick of lastDraftPicks) {
      const key = pick.sleeper_user_id ?? pick.manager_name;
      costLookup.set(`${key}|${normalizePlayerName(pick.player_name)}`, pick.round);
    }

    for (const roster of sleeperRosters) {
      const manager = managerLookup[roster.roster_id];
      const managerKey = manager?.sleeperUserId ?? `roster-${roster.roster_id}`;

      const candidates = [];
      for (const playerId of roster.players ?? []) {
        const player = playerNameById.get(playerId);
        if (!player) continue;

        const nameLower = normalizePlayerName(player.full_name);
        const costRound = costLookup.get(`${managerKey}|${nameLower}`);
        const currentRank = rankByName.get(nameLower);
        if (costRound === undefined || currentRank === undefined) continue;

        const adjustedCost = suggestRound(
          settings.keeper_cost_rule,
          settings.keeper_cost_adjustment,
          costRound
        );
        if (adjustedCost === null) continue;

        const valueRound = Math.ceil(currentRank / leagueSize);
        candidates.push({
          playerName: player.full_name,
          position: player.position,
          costRound: adjustedCost,
          valueRound,
          surplus: adjustedCost - valueRound,
        });
      }
      candidates.sort((a, b) => b.surplus - a.surplus);
      candidatesByManagerKey[managerKey] = candidates.slice(0, 5);

      // Also make sure this manager appears in the list even if they weren't
      // in the draft-history-derived managerMap (e.g. new to the league).
      if (!managerMap.has(managerKey)) {
        managerMap.set(managerKey, { key: managerKey, name: manager?.name ?? `Team ${roster.roster_id}` });
      }
    }
  }

  const managers = Array.from(managerMap.values());

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href={`/leagues/${league.id}`} className="text-sm text-white/50 hover:underline">
        &larr; Back to league
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name} — Keepers</h1>

      {settings?.keeper_enabled ? (
        <p className="mb-1 text-sm text-white/60">
          Your league's rule: {settings.keeper_count} keeper
          {settings.keeper_count === 1 ? "" : "s"} per team,{" "}
          {settings.keeper_cost_rule === "same_round" &&
            "costing the same round as last year's draft slot."}
          {settings.keeper_cost_rule === "round_minus_n" &&
            `costing last year's round minus ${settings.keeper_cost_adjustment}.`}
          {settings.keeper_cost_rule === "flat_round" &&
            `always costing round ${settings.keeper_cost_adjustment}.`}
          {settings.keeper_cost_rule === "auction_value" && "based on auction value."}
          {settings.keeper_cost_rule === "other" && "a custom rule."}
        </p>
      ) : (
        <p className="mb-1 text-sm text-white/60">
          This league isn't marked as using keepers — you can still add some
          below if that's changed, or double check on the league settings page.
        </p>
      )}
      {mostRecentSeason && (
        <p className="mb-6 text-xs text-white/40">
          Value candidates costed against {mostRecentSeason}'s draft.
        </p>
      )}

      {(!rankingSources || rankingSources.length === 0) && (
        <p className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          Upload or import a ranking source to see value-ranked keeper
          suggestions — until then, you can still add keepers manually below.
        </p>
      )}

      {rankingSources && rankingSources.length > 0 && (
        <form className="mb-6 flex items-center gap-2">
          <label className="text-sm text-white/60">Current-year rankings:</label>
          <select
            name="source"
            defaultValue={rankingSourceId}
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            {rankingSources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-white/30"
          >
            Update
          </button>
        </form>
      )}

      <KeeperHub
        leagueId={league.id}
        managers={managers}
        candidatesByManagerKey={candidatesByManagerKey}
        recentPicks={lastDraftPicks}
        existingKeepers={existingKeepers ?? []}
      />
    </main>
  );
}
