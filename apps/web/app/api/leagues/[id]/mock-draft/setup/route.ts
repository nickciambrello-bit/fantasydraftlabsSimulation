import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchSleeperDrafts,
  fetchSleeperDraftDetail,
  fetchSleeperRosters,
  fetchSleeperDraftPicks,
  fetchSleeperTradedPicks,
} from "@/lib/sleeper";
import { normalizePlayerName } from "@/lib/players";

function roundBucket(round: number): "early" | "mid" | "late" {
  if (round <= 3) return "early";
  if (round <= 8) return "mid";
  return "late";
}

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

  const { rankingSourceId, userDraftSlot } = await request.json();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id, sleeper_username, season")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  const { data: settings } = await supabase
    .from("league_settings")
    .select("league_size, draft_type, roster_positions")
    .eq("league_id", league.id)
    .single();

  if (!settings) {
    return NextResponse.json(
      { error: "Confirm this league's settings first before mock drafting." },
      { status: 400 }
    );
  }

  if (settings.draft_type !== "snake" && settings.draft_type !== "linear") {
    return NextResponse.json(
      { error: `Draft type "${settings.draft_type}" isn't supported yet.` },
      { status: 400 }
    );
  }

  const rosterPositions = settings.roster_positions as string[];
  const rounds = rosterPositions.length;

  const { data: rankingRows } = await supabase
    .from("ranking_entries")
    .select("rank, adp, player_name_clean, position, sleeper_player_id")
    .eq("ranking_source_id", rankingSourceId);

  if (!rankingRows || rankingRows.length === 0) {
    return NextResponse.json({ error: "That ranking source has no players in it." }, { status: 400 });
  }

  // Keepers — same exclusion + round-skip logic as the simulate route.
  const { data: keeperRows } = await supabase
    .from("keepers")
    .select("sleeper_user_id, manager_name, player_name, player_position, round")
    .eq("league_id", league.id);

  const keptNames = new Set(
    (keeperRows ?? []).map((k) => normalizePlayerName(k.player_name))
  );
  const keeperRoundsByManagerKey: Record<string, number[]> = {};
  for (const k of keeperRows ?? []) {
    const key = k.sleeper_user_id ?? k.manager_name;
    keeperRoundsByManagerKey[key] ??= [];
    keeperRoundsByManagerKey[key].push(k.round);
  }

  // Who is the signed-in user, in Sleeper terms? Needed to identify THEIR
  // OWN keeper rounds specifically, so the mock draft can auto-fill them
  // instead of asking for a pick that's already spent.
  let userSleeperUserId: string | null = null;
  if (league.sleeper_username) {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(league.sleeper_username)}`);
      const sleeperUser = await res.json();
      userSleeperUserId = sleeperUser?.user_id ?? null;
    } catch {
      // Proceed without it.
    }
  }
  const userLockedRounds = (keeperRows ?? [])
    .filter((k) => userSleeperUserId && k.sleeper_user_id === userSleeperUserId)
    .map((k) => ({ round: k.round, playerName: k.player_name, position: k.player_position }));

  // Actual live picks, if this league's real draft is underway.
  let fixedSeatAssignments: Record<number, string> | null = null;
  let usedRealDraftOrder = false;
  try {
    const drafts = await fetchSleeperDrafts(league.sleeper_league_id);
    if (drafts.length > 0) {
      const [draftDetail, liveRosters, livePicks] = await Promise.all([
        fetchSleeperDraftDetail(drafts[0].draft_id),
        fetchSleeperRosters(league.sleeper_league_id),
        fetchSleeperDraftPicks(league.sleeper_league_id),
      ]);

      if (draftDetail.draft_order && Object.keys(draftDetail.draft_order).length > 0) {
        fixedSeatAssignments = {};
        for (const [sleeperUserId, slot] of Object.entries(draftDetail.draft_order)) {
          fixedSeatAssignments[slot] = sleeperUserId;
        }
        usedRealDraftOrder = true;
      }

      const ownerByRosterId = new Map(liveRosters.map((r) => [r.roster_id, r.owner_id]));
      for (const pick of livePicks) {
        const name = pick.metadata?.first_name
          ? `${pick.metadata.first_name} ${pick.metadata.last_name ?? ""}`.trim()
          : null;
        if (name) keptNames.add(normalizePlayerName(name));

        const ownerId = ownerByRosterId.get(pick.roster_id);
        const key = ownerId ?? `roster-${pick.roster_id}`;
        keeperRoundsByManagerKey[key] ??= [];
        if (!keeperRoundsByManagerKey[key].includes(pick.round)) {
          keeperRoundsByManagerKey[key].push(pick.round);
        }
      }
    }
  } catch {
    // Proceed without live-draft awareness if Sleeper can't be reached.
  }

  // Traded picks this season, expressed as (round, seat) -> new owner's
  // manager key — a trade doesn't move a seat, it changes who's really
  // picking there for that specific round.
  const roundSeatOverrides: Record<string, string> = {};
  // Every manager's keeper rounds, mapped to their real seat — used so the
  // board can show "locked" cells and the on-the-clock label for ANY
  // manager's keeper round, not just the signed-in user's.
  const allLockedRounds: { round: number; seat: number; playerName: string; position: string | null }[] = [];

  if (fixedSeatAssignments) {
    const userIdToSeat: Record<string, number> = {};
    for (const [seat, uid] of Object.entries(fixedSeatAssignments)) {
      userIdToSeat[uid] = Number(seat);
    }

    for (const k of keeperRows ?? []) {
      if (!k.sleeper_user_id) continue;
      const seat = userIdToSeat[k.sleeper_user_id];
      if (seat === undefined) continue;
      allLockedRounds.push({ round: k.round, seat, playerName: k.player_name, position: k.player_position });
    }

    try {
      const [tradedPicks, rosters] = await Promise.all([
        fetchSleeperTradedPicks(league.sleeper_league_id),
        fetchSleeperRosters(league.sleeper_league_id),
      ]);

      const rosterIdToOwnerUserId: Record<number, string | null> = {};
      for (const r of rosters) rosterIdToOwnerUserId[r.roster_id] = r.owner_id;

      for (const trade of tradedPicks) {
        if (trade.season !== league.season) continue;
        if (trade.owner_id === trade.roster_id) continue;

        const originalOwnerUserId = rosterIdToOwnerUserId[trade.roster_id];
        const newOwnerUserId = rosterIdToOwnerUserId[trade.owner_id];
        if (!originalOwnerUserId || !newOwnerUserId) continue;

        const originalSeat = userIdToSeat[originalOwnerUserId];
        if (originalSeat === undefined) continue;

        roundSeatOverrides[`${trade.round}-${originalSeat}`] = newOwnerUserId;
      }
    } catch {
      // Proceed without trade overrides if Sleeper can't be reached.
    }
  }

  const sortable = rankingRows
    .filter((r) => !keptNames.has(normalizePlayerName(r.player_name_clean)))
    .map((r) => ({ ...r, sortKey: r.rank ?? r.adp ?? 9999 }));
  sortable.sort((a, b) => a.sortKey - b.sortKey);

  const rankings = sortable.map((r, i) => ({
    rank: i + 1,
    name: r.player_name_clean,
    position: r.position ? r.position.replace(/\d+$/, "").toUpperCase() : null,
    sleeper_player_id: r.sleeper_player_id,
  }));

  const { data: seasons } = await supabase
    .from("league_history_seasons")
    .select("id, season")
    .eq("league_id", league.id);

  const seasonIds = (seasons ?? []).map((s) => s.id);
  const seasonBySeasonId = new Map((seasons ?? []).map((s) => [s.id, s.season]));

  if (seasonIds.length === 0) {
    return NextResponse.json(
      { error: "Sync this league's history first before mock drafting." },
      { status: 400 }
    );
  }

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("round, pick_no, sleeper_user_id, manager_name, player_name, player_position, history_season_id")
    .in("history_season_id", seasonIds);

  const { data: adpSeasonRows } = await supabase
    .from("historical_adp_seasons")
    .select("id, season")
    .eq("user_id", user.id);
  const adpSeasonIds = (adpSeasonRows ?? []).map((s) => s.id);

  const { data: adpPlayerRows } =
    adpSeasonIds.length > 0
      ? await supabase
          .from("historical_adp_players")
          .select("adp_season_id, player_name, adp")
          .in("adp_season_id", adpSeasonIds)
      : { data: [] };

  const adpByKey = new Map<string, number>();
  for (const row of adpPlayerRows ?? []) {
    if (row.adp == null) continue;
    const seasonLabel = (adpSeasonRows ?? []).find((s) => s.id === row.adp_season_id)?.season;
    if (!seasonLabel) continue;
    adpByKey.set(`${seasonLabel}|${normalizePlayerName(row.player_name)}`, row.adp);
  }

  const profilesByKey: Record<
    string,
    { key: string; name: string; early: Record<string, number>; mid: Record<string, number>; late: Record<string, number> }
  > = {};

  const reachSumByManagerPos: Record<string, Record<string, number>> = {};
  const reachCountByManagerPos: Record<string, Record<string, number>> = {};

  for (const pick of picks ?? []) {
    const key = pick.sleeper_user_id ?? pick.manager_name;
    profilesByKey[key] ??= { key, name: pick.manager_name, early: {}, mid: {}, late: {} };
    const bucket = roundBucket(pick.round);
    const pos = pick.player_position ?? "UNKNOWN";
    profilesByKey[key][bucket][pos] = (profilesByKey[key][bucket][pos] ?? 0) + 1;

    const season = seasonBySeasonId.get(pick.history_season_id);
    if (season && pick.pick_no != null && pick.player_name) {
      const adp = adpByKey.get(`${season}|${normalizePlayerName(pick.player_name)}`);
      if (adp != null) {
        reachSumByManagerPos[key] ??= {};
        reachCountByManagerPos[key] ??= {};
        reachSumByManagerPos[key][pos] = (reachSumByManagerPos[key][pos] ?? 0) + (adp - pick.pick_no);
        reachCountByManagerPos[key][pos] = (reachCountByManagerPos[key][pos] ?? 0) + 1;
      }
    }
  }

  const reachBiasByManagerKey: Record<string, Record<string, number>> = {};
  for (const key of Object.keys(reachSumByManagerPos)) {
    reachBiasByManagerKey[key] = {};
    for (const pos of Object.keys(reachSumByManagerPos[key])) {
      const count = reachCountByManagerPos[key][pos];
      if (count >= 3) {
        reachBiasByManagerKey[key][pos] = Math.round((reachSumByManagerPos[key][pos] / count) * 10) / 10;
      }
    }
  }

  const managerProfiles = Object.values(profilesByKey).map((p) => ({
    ...p,
    keeper_rounds: keeperRoundsByManagerKey[p.key] ?? [],
    reach_bias: reachBiasByManagerKey[p.key] ?? {},
  }));

  if (managerProfiles.length === 0) {
    return NextResponse.json(
      { error: "No draft history found for this league yet." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    leagueSize: settings.league_size,
    draftType: settings.draft_type,
    rounds,
    rosterPositions,
    userDraftSlot,
    rankings,
    managerProfiles,
    fixedSeatAssignments,
    usedRealDraftOrder,
    userLockedRounds,
    allLockedRounds,
    roundSeatOverrides,
  });
}
