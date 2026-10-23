import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  fetchSleeperDrafts,
  fetchSleeperDraftDetail,
  fetchSleeperUsers,
  fetchSleeperRosters,
  fetchSleeperDraftPicks,
  fetchSleeperTradedPicks,
  buildManagerNameLookup,
} from "@/lib/sleeper";

export default async function DraftBoardPage({
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
    .select("id, name, sleeper_league_id, season")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  const drafts = await fetchSleeperDrafts(league.sleeper_league_id);

  if (drafts.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href={`/leagues/${league.id}`} className="text-sm text-white/50 hover:underline">
          &larr; Back to league
        </Link>
        <h1 className="mb-4 mt-3 text-xl font-semibold">{league.name} — Draft Board</h1>
        <p className="text-sm text-white/50">
          Sleeper doesn't have a draft set up for this league yet.
        </p>
      </main>
    );
  }

  const draft = drafts[0];
  const [draftDetail, sleeperUsers, sleeperRosters, picks, tradedPicks, keeperRows] = await Promise.all([
    fetchSleeperDraftDetail(draft.draft_id),
    fetchSleeperUsers(league.sleeper_league_id),
    fetchSleeperRosters(league.sleeper_league_id),
    fetchSleeperDraftPicks(league.sleeper_league_id),
    fetchSleeperTradedPicks(league.sleeper_league_id),
    supabase.from("keepers").select("sleeper_user_id, manager_name, player_name, player_position, round").eq("league_id", league.id).then((r) => r.data ?? []),
  ]);

  const managerByRosterId = buildManagerNameLookup(sleeperUsers, sleeperRosters);
  const rosterIdByUserId = new Map(sleeperRosters.map((r) => [r.owner_id, r.roster_id]));
  const ownerUserIdByRosterId = new Map(sleeperRosters.map((r) => [r.roster_id, r.owner_id]));

  const leagueSize = sleeperRosters.length;
  const rounds = draftDetail.settings?.rounds ?? 0;
  const hasDraftOrder =
    draftDetail.draft_order && Object.keys(draftDetail.draft_order).length > 0;

  // slot (number) -> manager name, derived from draft_order (user_id -> slot)
  // cross-referenced with which roster that user owns. This is each
  // manager's BASE seat — trades below can override who actually picks
  // there in a specific round, without moving the seat itself.
  const managerBySlot = new Map<number, string>();
  const slotByUserId = new Map<string, number>();
  if (draftDetail.draft_order) {
    for (const [sleeperUserId, slot] of Object.entries(draftDetail.draft_order)) {
      const rosterId = rosterIdByUserId.get(sleeperUserId);
      const name =
        rosterId !== undefined ? managerByRosterId[rosterId]?.name : undefined;
      managerBySlot.set(slot, name ?? "Unknown");
      slotByUserId.set(sleeperUserId, slot);
    }
  }

  // Traded picks this season: "round-slot" -> the manager who now actually
  // owns that pick, if different from the seat's usual manager.
  const tradedOwnerByRoundSlot = new Map<string, string>();
  if (hasDraftOrder) {
    for (const trade of tradedPicks) {
      if (trade.season !== league.season) continue;
      if (trade.owner_id === trade.roster_id) continue;

      const originalOwnerUserId = ownerUserIdByRosterId.get(trade.roster_id);
      const newOwnerUserId = ownerUserIdByRosterId.get(trade.owner_id);
      if (!originalOwnerUserId || !newOwnerUserId) continue;

      const originalSlot = slotByUserId.get(originalOwnerUserId);
      if (originalSlot === undefined) continue;

      const newOwnerRosterId = rosterIdByUserId.get(newOwnerUserId);
      const newOwnerName =
        newOwnerRosterId !== undefined ? managerByRosterId[newOwnerRosterId]?.name : undefined;
      if (newOwnerName) {
        tradedOwnerByRoundSlot.set(`${trade.round}-${originalSlot}`, newOwnerName);
      }
    }
  }

  // "round-slot" -> pick info, for picks already made in the real draft.
  const pickByRoundSlot = new Map<string, { name: string; position: string | null }>();
  for (const pick of picks) {
    const name = pick.metadata?.first_name
      ? `${pick.metadata.first_name} ${pick.metadata.last_name ?? ""}`.trim()
      : "Unknown player";
    pickByRoundSlot.set(`${pick.round}-${pick.draft_slot}`, {
      name,
      position: pick.metadata?.position ?? null,
    });
  }

  // "round-slot" -> logged keeper, for rounds not yet reached in a live
  // draft (or previewing before the draft has even started).
  const keeperByRoundSlot = new Map<string, { name: string; position: string | null }>();
  if (hasDraftOrder) {
    for (const k of keeperRows) {
      const slot = k.sleeper_user_id ? slotByUserId.get(k.sleeper_user_id) : undefined;
      if (slot === undefined) continue;
      keeperByRoundSlot.set(`${k.round}-${slot}`, {
        name: k.player_name,
        position: k.player_position,
      });
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href={`/leagues/${league.id}`} className="text-sm text-white/50 hover:underline">
        &larr; Back to league
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name} — Draft Board</h1>
      <p className="mb-6 text-sm text-white/60">
        Pulled live from Sleeper, plus your logged keepers and this season's
        traded picks — use this to double-check everything lines up with
        what you see in the Sleeper app.
      </p>

      <div className="mb-6 flex flex-wrap gap-3 text-sm text-white/60">
        <span className="rounded-md bg-white/5 px-3 py-1.5">
          Status: {draftDetail.status}
        </span>
        <span className="rounded-md bg-white/5 px-3 py-1.5 capitalize">
          Type: {draftDetail.type}
        </span>
        <span className="rounded-md bg-white/5 px-3 py-1.5">
          {rounds} rounds · {leagueSize} teams
        </span>
        {tradedOwnerByRoundSlot.size > 0 && (
          <span className="rounded-md bg-white/5 px-3 py-1.5">
            {tradedOwnerByRoundSlot.size} traded pick{tradedOwnerByRoundSlot.size === 1 ? "" : "s"} this season
          </span>
        )}
      </div>

      {!hasDraftOrder && (
        <p className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          Sleeper doesn't have a draft order set for this league yet — slot
          columns, keepers, and traded picks below will show "TBD" until
          your commissioner sets it.
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-3 text-xs text-white/40">
        <span>🔒 = your logged keeper</span>
        <span>🔄 = traded pick, shown with the new owner</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5">
            <tr>
              <th className="sticky left-0 bg-white/5 px-3 py-2">Rd</th>
              {Array.from({ length: leagueSize }, (_, i) => i + 1).map((slot) => (
                <th key={slot} className="px-3 py-2 whitespace-nowrap">
                  Slot {slot}
                  <div className="text-xs font-normal text-white/40">
                    {managerBySlot.get(slot) ?? "TBD"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
              <tr key={round} className="border-t border-white/10">
                <td className="sticky left-0 bg-black/40 px-3 py-2 font-medium">{round}</td>
                {Array.from({ length: leagueSize }, (_, i) => i + 1).map((slot) => {
                  const key = `${round}-${slot}`;
                  const pick = pickByRoundSlot.get(key);
                  const keeper = !pick ? keeperByRoundSlot.get(key) : undefined;
                  const tradedTo = !pick ? tradedOwnerByRoundSlot.get(key) : undefined;

                  return (
                    <td key={slot} className="px-3 py-2 whitespace-nowrap text-white/70">
                      {pick ? (
                        <span>
                          {pick.name}
                          {pick.position ? ` (${pick.position})` : ""}
                        </span>
                      ) : keeper ? (
                        <span className="text-emerald-300">
                          🔒 {keeper.name}
                          {keeper.position ? ` (${keeper.position})` : ""}
                        </span>
                      ) : tradedTo ? (
                        <span className="text-yellow-300">🔄 {tradedTo}</span>
                      ) : (
                        <span className="text-white/30">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
