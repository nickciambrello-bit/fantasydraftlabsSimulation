import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchLeagueSeasonChain,
  fetchSleeperUsers,
  fetchSleeperRosters,
  fetchSleeperDraftPicks,
  buildManagerNameLookup,
} from "@/lib/sleeper";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  try {
    const seasonChain = await fetchLeagueSeasonChain(league.sleeper_league_id);

    const results: { season: string; picks: number; teams: number }[] = [];

    for (const seasonLeague of seasonChain) {
      // Skip seasons we've already synced.
      const { data: existing } = await supabase
        .from("league_history_seasons")
        .select("id")
        .eq("league_id", league.id)
        .eq("season", seasonLeague.season)
        .maybeSingle();

      let historySeasonId = existing?.id;

      if (!historySeasonId) {
        const { data: inserted, error: insertError } = await supabase
          .from("league_history_seasons")
          .insert({
            league_id: league.id,
            sleeper_league_id: seasonLeague.league_id,
            season: seasonLeague.season,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          throw new Error(
            `Could not save season ${seasonLeague.season}: ${insertError?.message}`
          );
        }
        historySeasonId = inserted.id;
      } else {
        // Already synced this season previously — clear old rows so we can
        // re-insert fresh ones without duplicating.
        await supabase.from("draft_picks").delete().eq("history_season_id", historySeasonId);
        await supabase.from("season_standings").delete().eq("history_season_id", historySeasonId);
      }

      const [sleeperUsers, sleeperRosters, sleeperPicks] = await Promise.all([
        fetchSleeperUsers(seasonLeague.league_id),
        fetchSleeperRosters(seasonLeague.league_id),
        fetchSleeperDraftPicks(seasonLeague.league_id),
      ]);

      const managerLookup = buildManagerNameLookup(sleeperUsers, sleeperRosters);

      // Insert draft picks for this season.
      if (sleeperPicks.length > 0) {
        const pickRows = sleeperPicks.map((pick) => {
          const manager = managerLookup[pick.roster_id];
          const playerName = pick.metadata?.first_name
            ? `${pick.metadata.first_name} ${pick.metadata.last_name ?? ""}`.trim()
            : "Unknown player";

          return {
            history_season_id: historySeasonId,
            round: pick.round,
            pick_no: pick.pick_no,
            draft_slot: pick.draft_slot,
            roster_id: pick.roster_id,
            sleeper_user_id: manager?.sleeperUserId ?? null,
            manager_name: manager?.name ?? `Team ${pick.roster_id}`,
            player_id: pick.player_id,
            player_name: playerName,
            player_position: pick.metadata?.position ?? null,
            player_team: pick.metadata?.team ?? null,
            is_keeper: Boolean(pick.is_keeper),
          };
        });

        await supabase.from("draft_picks").insert(pickRows);
      }

      // Insert standings for this season (regular-season record, ranked by
      // wins then points — not final playoff results, which Sleeper doesn't
      // expose directly).
      if (sleeperRosters.length > 0) {
        const ranked = [...sleeperRosters].sort((a, b) => {
          if (b.settings.wins !== a.settings.wins) {
            return b.settings.wins - a.settings.wins;
          }
          return (b.settings.fpts ?? 0) - (a.settings.fpts ?? 0);
        });

        const standingsRows = ranked.map((roster, index) => {
          const manager = managerLookup[roster.roster_id];
          return {
            history_season_id: historySeasonId,
            roster_id: roster.roster_id,
            sleeper_user_id: manager?.sleeperUserId ?? null,
            manager_name: manager?.name ?? `Team ${roster.roster_id}`,
            wins: roster.settings.wins ?? 0,
            losses: roster.settings.losses ?? 0,
            ties: roster.settings.ties ?? 0,
            points_for: roster.settings.fpts ?? 0,
            points_against: roster.settings.fpts_against ?? 0,
            regular_season_rank: index + 1,
          };
        });

        await supabase.from("season_standings").insert(standingsRows);
      }

      results.push({
        season: seasonLeague.season,
        picks: sleeperPicks.length,
        teams: sleeperRosters.length,
      });
    }

    return NextResponse.json({ success: true, seasons: results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Sync failed." },
      { status: 500 }
    );
  }
}
