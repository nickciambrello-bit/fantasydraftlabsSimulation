import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSleeperDrafts, fetchSleeperDraftDetail, fetchSleeperTradedPicks, fetchSleeperRosters } from "@/lib/sleeper";
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

  const { rankingSourceId, userDraftSlot, numSimulations } = await request.json();

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
      { error: "Confirm this league's settings first (on the league page) before simulating." },
      { status: 400 }
    );
  }

  if (settings.draft_type !== "snake" && settings.draft_type !== "linear") {
    return NextResponse.json(
      { error: `Draft type "${settings.draft_type}" isn't supported yet — only snake and linear drafts are.` },
      { status: 400 }
    );
  }

  const rosterPositions = settings.roster_positions as string[];
  const rounds = rosterPositions.length;

  // Rankings: pull the chosen source, fall back from rank -> adp -> row order
  // if some entries are missing an explicit rank.
  const { data: rankingRows } = await supabase
    .from("ranking_entries")
    .select("rank, adp, player_name_clean, position, sleeper_player_id")
    .eq("ranking_source_id", rankingSourceId);

  if (!rankingRows || rankingRows.length === 0) {
    return NextResponse.json({ error: "That ranking source has no players in it." }, { status: 400 });
  }

  // Who is the signed-in user, in Sleeper terms? Needed to correctly
  // identify THEIR OWN keeper rounds (not just any manager's).
  let userSleeperUserId: string | null = null;
  if (league.sleeper_username) {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(league.sleeper_username)}`);
      const sleeperUser = await res.json();
      userSleeperUserId = sleeperUser?.user_id ?? null;
    } catch {
      // Proceed without it — the fix just won't apply this run.
    }
  }

  // Keepers: pull this league's kept players so they can be removed from
  // the available pool, and so each manager's "already used" rounds can be
  // passed to the simulator.
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

  // The user's OWN keeper rounds specifically — these get excluded from
  // "what to draft" recommendations entirely, since that pick is already
  // spent. Includes player name/position so the frontend can show what's
  // actually locked in, not just that a round is unavailable.
  const userKeeperRounds = userSleeperUserId
    ? keeperRoundsByManagerKey[userSleeperUserId] ?? []
    : [];
  const userLockedRounds = (keeperRows ?? [])
    .filter((k) => userSleeperUserId && k.sleeper_user_id === userSleeperUserId)
    .map((k) => ({ round: k.round, playerName: k.player_name, position: k.player_position }));

  const sortable = rankingRows
    .filter((r) => !keptNames.has(normalizePlayerName(r.player_name_clean)))
    .map((r) => ({
      ...r,
      sortKey: r.rank ?? r.adp ?? 9999,
    }));
  sortable.sort((a, b) => a.sortKey - b.sortKey);

  const rankings = sortable.map((r, i) => ({
    rank: i + 1,
    name: r.player_name_clean,
    // Defensively strip a trailing rank number some sources jam onto the
    // position (e.g. "WR261" -> "WR"), so grouping by position downstream
    // always groups by actual position, not by a near-unique per-player string.
    position: r.position ? r.position.replace(/\d+$/, "").toUpperCase() : null,
    sleeper_player_id: r.sleeper_player_id,
  }));

  // Manager profiles: every manager who appears in this league's synced
  // draft history, with position counts bucketed by round (early/mid/late).
  const { data: seasons } = await supabase
    .from("league_history_seasons")
    .select("id, season")
    .eq("league_id", league.id);

  const seasonIds = (seasons ?? []).map((s) => s.id);
  const seasonBySeasonId = new Map((seasons ?? []).map((s) => [s.id, s.season]));

  if (seasonIds.length === 0) {
    return NextResponse.json(
      { error: "Sync this league's history first (on the History page) before simulating." },
      { status: 400 }
    );
  }

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("round, pick_no, sleeper_user_id, manager_name, player_name, player_position, history_season_id")
    .in("history_season_id", seasonIds);

  // Historical ADP: lets us tell how far ahead of (or behind) that
  // season's real consensus a manager typically drafts a position —
  // a sharper, more specific signal than just "which round bucket."
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

  // "season|player name lowercase" -> adp
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

  // Per-manager, per-position: running sum of (adp - actual pick) and a
  // count, only for picks we could match to a real historical ADP.
  // Positive average = actual pick number was SMALLER than typical ADP,
  // i.e. they drafted EARLIER than consensus for that position (a reach).
  // Negative = they drafted LATER than consensus (patient/value-seeking).
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
        // Only trust this with a few real data points, otherwise leave it
        // at neutral (0) rather than overfitting to 1-2 picks.
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

  // Real draft slot assignments: if your commissioner has set the draft
  // order in Sleeper, use it — every manager gets seated in their ACTUAL
  // real slot for every simulation, instead of us randomly shuffling
  // everyone into the other seats. Falls back gracefully (no assignments
  // sent) if the draft order isn't set yet, or if Sleeper can't be reached.
  let fixedSeatAssignments: Record<number, string> | null = null;
  let usedRealDraftOrder = false;
  try {
    const drafts = await fetchSleeperDrafts(league.sleeper_league_id);
    if (drafts.length > 0) {
      const draftDetail = await fetchSleeperDraftDetail(drafts[0].draft_id);
      if (draftDetail.draft_order && Object.keys(draftDetail.draft_order).length > 0) {
        fixedSeatAssignments = {};
        for (const [sleeperUserId, slot] of Object.entries(draftDetail.draft_order)) {
          fixedSeatAssignments[slot] = sleeperUserId;
        }
        usedRealDraftOrder = true;
      }
    }
  } catch {
    // Sleeper unreachable or draft not set up — proceed without it, the
    // simulation still works, just with randomized opponent seating.
  }

  // Traded draft picks: a trade doesn't move anyone's SEAT, it changes
  // whose tendencies should govern a specific (round, seat) pick — e.g. if
  // manager A traded away their round-4 pick to manager B, round 4 at A's
  // seat should be drafted using B's profile, not A's. Only meaningful
  // when we know real seats (fixedSeatAssignments), since without a real
  // draft order there's no fixed concept of "which seat is A's" to override.
  const roundSeatOverrides: Record<string, string> = {};
  if (fixedSeatAssignments) {
    try {
      const [tradedPicks, rosters] = await Promise.all([
        fetchSleeperTradedPicks(league.sleeper_league_id),
        fetchSleeperRosters(league.sleeper_league_id),
      ]);

      const rosterIdToOwnerUserId: Record<number, string | null> = {};
      for (const r of rosters) rosterIdToOwnerUserId[r.roster_id] = r.owner_id;

      const userIdToSeat: Record<string, number> = {};
      for (const [seat, userId] of Object.entries(fixedSeatAssignments)) {
        userIdToSeat[userId] = Number(seat);
      }

      for (const trade of tradedPicks) {
        if (trade.season !== league.season) continue; // only this draft matters
        if (trade.owner_id === trade.roster_id) continue; // never actually traded away

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

  const modalUrl = process.env.MODAL_SIM_URL;
  const modalApiKey = process.env.MODAL_API_KEY;

  if (!modalUrl || !modalApiKey) {
    return NextResponse.json(
      { error: "Simulation engine isn't configured yet (missing Modal URL/API key)." },
      { status: 500 }
    );
  }

  try {
    const modalRes = await fetch(modalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": modalApiKey,
      },
      body: JSON.stringify({
        league_size: settings.league_size,
        draft_type: settings.draft_type,
        rounds,
        user_draft_slot: userDraftSlot,
        rankings,
        manager_profiles: managerProfiles,
        num_simulations: numSimulations ?? 300,
        fixed_seat_assignments: fixedSeatAssignments ?? undefined,
        user_keeper_rounds: userKeeperRounds,
        round_seat_overrides: roundSeatOverrides,
      }),
    });

    const data = await modalRes.json();
    if (!modalRes.ok) {
      throw new Error(data.detail ?? "Simulation engine returned an error.");
    }

    // League-wide early-round (rounds 1–3) position tendency, aggregated
    // across every manager — this is what "why this works in your league"
    // draws from. It's compared against a naive even split (25% each across
    // the 4 core positions) since we don't have an external market-ADP
    // baseline — an honest proxy, not literal "vs. the market."
    const CORE_POSITIONS = ["QB", "RB", "WR", "TE"];
    const earlyCoreCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    let earlyCoreTotal = 0;
    for (const pick of picks ?? []) {
      if (pick.round > 3) continue;
      const pos = pick.player_position ?? "";
      if (CORE_POSITIONS.includes(pos)) {
        earlyCoreCounts[pos] += 1;
        earlyCoreTotal += 1;
      }
    }
    const leagueTendency =
      earlyCoreTotal > 0
        ? CORE_POSITIONS.map((pos) => ({
            position: pos,
            earlyShare: Math.round((earlyCoreCounts[pos] / earlyCoreTotal) * 100),
          })).sort((a, b) => b.earlyShare - a.earlyShare)
        : null;

    return NextResponse.json({
      ...data,
      meta: {
        historySeasonsCount: seasonIds.length,
        leagueTendency,
        userDraftSlot,
        leagueSize: settings.league_size,
        draftType: settings.draft_type,
        numSimulations: numSimulations ?? 300,
        usedRealDraftOrder,
        userLockedRounds,
        tradedPicksApplied: Object.keys(roundSeatOverrides).length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not reach the simulation engine." },
      { status: 500 }
    );
  }
}
