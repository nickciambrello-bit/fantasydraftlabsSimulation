"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  buildPickOrder,
  pickForManager,
  type RankingRow,
  type ManagerProfile,
} from "@fantasy-labs/engine";

type RankingSource = { id: string; name: string };
type DraftPlan = { id: string; name: string };

type SetupData = {
  leagueSize: number;
  draftType: string;
  rounds: number;
  rosterPositions: string[];
  userDraftSlot: number;
  rankings: RankingRow[];
  managerProfiles: ManagerProfile[];
  fixedSeatAssignments: Record<number, string> | null;
  usedRealDraftOrder: boolean;
  userLockedRounds: { round: number; playerName: string; position: string | null }[];
};

type PlanRound = {
  round: number;
  primary_target_name: string | null;
  primary_target_position: string | null;
};

type MadePick = {
  round: number;
  overallPick: number;
  seat: number;
  isUser: boolean;
  managerName: string;
  player: RankingRow;
  pivoted: boolean;
};

const BOT_PICK_DELAY_MS = 350;

export default function MockDraftClient({
  leagueId,
  sleeperLeagueId,
  savedUsername,
  leagueSize,
  draftType,
  rankingSources,
  draftPlans,
}: {
  leagueId: string;
  sleeperLeagueId: string;
  savedUsername: string | null;
  leagueSize: number;
  draftType: string;
  rankingSources: RankingSource[];
  draftPlans: DraftPlan[];
}) {
  const supabase = createClient();

  // --- Setup form state ---
  const [rankingSourceId, setRankingSourceId] = useState(rankingSources[0]?.id ?? "");
  const [draftPlanId, setDraftPlanId] = useState<string>("");
  const [draftSlot, setDraftSlot] = useState(1);
  const [starting, setStarting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Auto-detect the real draft slot using the league's saved Sleeper
  // username, same as the Simulate page — no re-entry needed.
  useEffect(() => {
    if (!savedUsername) return;
    (async () => {
      try {
        const userRes = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(savedUsername)}`);
        const sleeperUser = await userRes.json();
        if (!sleeperUser?.user_id) return;
        const draftsRes = await fetch(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/drafts`);
        const drafts = await draftsRes.json();
        if (!drafts || drafts.length === 0) return;
        const draftDetailRes = await fetch(`https://api.sleeper.app/v1/draft/${drafts[0].draft_id}`);
        const draftDetail = await draftDetailRes.json();
        const slot = draftDetail?.draft_order?.[sleeperUser.user_id];
        if (slot) setDraftSlot(slot);
      } catch {
        // Fall back silently to manual slot selection.
      }
    })();
  }, [savedUsername, sleeperLeagueId]);

  // --- Live draft state ---
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [planRounds, setPlanRounds] = useState<Record<number, PlanRound>>({});
  const [pickOrder, setPickOrder] = useState<number[]>([]);
  const [seatToProfile, setSeatToProfile] = useState<Record<number, ManagerProfile | null>>({});
  const [available, setAvailable] = useState<RankingRow[]>([]);
  const [draftedCounts, setDraftedCounts] = useState<Record<number, Record<string, number>>>({});
  const [picksMade, setPicksMade] = useState<MadePick[]>([]);
  const [pickIndex, setPickIndex] = useState(0);
  const [search, setSearch] = useState("");
  const isAdvancingRef = useRef(false);

  const draftTypeSupported = draftType === "snake" || draftType === "linear";
  const complete = setup !== null && pickIndex >= pickOrder.length;

  const currentSeat = pickOrder[pickIndex];
  const currentRound = setup ? Math.floor(pickIndex / setup.leagueSize) + 1 : 0;
  const currentLockedInfo = setup?.userLockedRounds.find((l) => l.round === currentRound) ?? null;
  const isUserTurn = setup !== null && !complete && currentSeat === setup.userDraftSlot && !currentLockedInfo;

  async function handleStart() {
    setStarting(true);
    setSetupError(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/mock-draft/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rankingSourceId, userDraftSlot: draftSlot }),
      });
      const data: SetupData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start mock draft.");

      if (draftPlanId) {
        const { data: rounds } = await supabase
          .from("draft_plan_rounds")
          .select("round, primary_target_name, primary_target_position")
          .eq("draft_plan_id", draftPlanId);
        const byRound: Record<number, PlanRound> = {};
        for (const r of rounds ?? []) byRound[r.round] = r;
        setPlanRounds(byRound);
      } else {
        setPlanRounds({});
      }

      const order = buildPickOrder(data.leagueSize, data.rounds, data.draftType);

      // Seat assignment: real draft order if known, otherwise one random
      // shuffle for this whole mock (not re-shuffled per pick — a mock
      // draft is one realization, not a Monte Carlo run).
      const seatMap: Record<number, ManagerProfile | null> = {};
      if (data.fixedSeatAssignments) {
        const byKey = new Map(data.managerProfiles.map((p) => [p.key, p]));
        for (let seat = 1; seat <= data.leagueSize; seat++) {
          if (seat === data.userDraftSlot) {
            seatMap[seat] = null;
            continue;
          }
          const key = data.fixedSeatAssignments[seat];
          seatMap[seat] = key ? byKey.get(key) ?? null : null;
        }
      } else {
        const shuffled = [...data.managerProfiles].sort(() => Math.random() - 0.5);
        let idx = 0;
        for (let seat = 1; seat <= data.leagueSize; seat++) {
          if (seat === data.userDraftSlot) {
            seatMap[seat] = null;
          } else {
            seatMap[seat] = shuffled[idx] ?? null;
            idx++;
          }
        }
      }

      setSetup(data);
      setPickOrder(order);
      setSeatToProfile(seatMap);
      setAvailable(data.rankings);
      setDraftedCounts({});
      setPicksMade([]);
      setPickIndex(0);
    } catch (err: any) {
      setSetupError(err.message ?? "Something went wrong.");
    } finally {
      setStarting(false);
    }
  }

  function lockInKeeper(locked: { round: number; playerName: string; position: string | null }) {
    if (!setup) return;
    const seat = pickOrder[pickIndex];

    setPicksMade((prev) => [
      ...prev,
      {
        round: locked.round,
        overallPick: pickIndex + 1,
        seat,
        isUser: true,
        managerName: "You",
        player: { rank: -1, name: locked.playerName, position: locked.position, sleeper_player_id: null },
        pivoted: false,
      },
    ]);
    // Keepers are never in the `available` pool to begin with (the setup
    // route already excludes them), so nothing to remove here — just
    // advance past this round.
    setPickIndex((i) => i + 1);
  }

  function draftPlayer(player: RankingRow, isUser: boolean) {
    if (!setup) return;
    const seat = pickOrder[pickIndex];
    const round = Math.floor(pickIndex / setup.leagueSize) + 1;
    const profile = seatToProfile[seat];

    const plan = planRounds[round];
    const pivoted = Boolean(
      isUser && plan?.primary_target_position && plan.primary_target_position !== player.position
    );

    setPicksMade((prev) => [
      ...prev,
      {
        round,
        overallPick: pickIndex + 1,
        seat,
        isUser,
        managerName: isUser ? "You" : profile?.name ?? `Seat ${seat}`,
        player,
        pivoted,
      },
    ]);
    setAvailable((prev) => prev.filter((p) => p.rank !== player.rank));
    setDraftedCounts((prev) => {
      const seatCounts = { ...(prev[seat] ?? {}) };
      const pos = player.position ?? "UNKNOWN";
      seatCounts[pos] = (seatCounts[pos] ?? 0) + 1;
      return { ...prev, [seat]: seatCounts };
    });
    setPickIndex((i) => i + 1);
    setSearch("");
  }

  // Auto-advance: bot picks, AND the user's own locked (keeper) rounds,
  // which need no input — just record the keeper and move on.
  useEffect(() => {
    if (!setup || complete || isUserTurn || isAdvancingRef.current) return;
    isAdvancingRef.current = true;

    const timer = setTimeout(() => {
      const seat = pickOrder[pickIndex];
      const round = Math.floor(pickIndex / setup.leagueSize) + 1;

      if (seat === setup.userDraftSlot) {
        // Must be a locked (keeper) round — isUserTurn is false specifically
        // because currentLockedInfo is set in that case.
        if (currentLockedInfo) lockInKeeper(currentLockedInfo);
      } else {
        const profile = seatToProfile[seat];
        if (available.length > 0) {
          const chosen = pickForManager(available, profile, round, draftedCounts[seat] ?? {});
          draftPlayer(chosen, false);
        }
      }
      isAdvancingRef.current = false;
    }, BOT_PICK_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickIndex, setup, isUserTurn, complete]);

  const filteredAvailable = useMemo(() => {
    if (!setup) return [];
    const q = search.trim().toLowerCase();
    const pool = q ? available.filter((p) => p.name.toLowerCase().includes(q)) : available;
    return pool.slice(0, 20);
  }, [available, search, setup]);

  const currentPlanTarget = setup ? planRounds[currentRound] : undefined;

  if (!draftTypeSupported) {
    return (
      <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
        This league's draft type ("{draftType}") isn't supported yet — only
        snake and linear drafts are.
      </p>
    );
  }

  if (!setup) {
    return (
      <div>
        <div className="mb-6 grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm text-white/60">Rankings to use</label>
            <select
              value={rankingSourceId}
              onChange={(e) => setRankingSourceId(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            >
              {rankingSources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-white/60">Guide with a draft plan (optional)</label>
            <select
              value={draftPlanId}
              onChange={(e) => setDraftPlanId(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            >
              <option value="">None — just show rankings</option>
              {draftPlans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-white/60">Your draft slot</label>
            <select
              value={draftSlot}
              onChange={(e) => setDraftSlot(Number(e.target.value))}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            >
              {Array.from({ length: leagueSize }, (_, i) => i + 1).map((slot) => (
                <option key={slot} value={slot}>Pick {slot}</option>
              ))}
            </select>
          </div>
        </div>

        {setupError && <p className="mb-4 text-sm text-red-400">{setupError}</p>}

        <button
          onClick={handleStart}
          disabled={starting}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {starting ? "Setting up..." : "Start Mock Draft"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm">
        <span className="text-white/60">
          {setup.usedRealDraftOrder ? "Using your league's real draft order. " : "Opponents randomly seated. "}
          {complete ? "Draft complete." : `Round ${currentRound} of ${setup.rounds}`}
        </span>
        <button
          onClick={() => setSetup(null)}
          className="text-xs text-white/40 hover:text-white/70 hover:underline"
        >
          Start over
        </button>
      </div>

      {!complete && !isUserTurn && (
        <p className="mb-4 text-sm text-white/50">
          {seatToProfile[currentSeat]?.name ?? `Seat ${currentSeat}`} is picking...
        </p>
      )}

      {!complete && isUserTurn && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <h2 className="mb-2 text-sm font-medium">Your pick — Round {currentRound}</h2>
          {currentPlanTarget?.primary_target_name && (
            <p className="mb-3 text-sm text-emerald-300">
              Your plan says: {currentPlanTarget.primary_target_position} —{" "}
              {currentPlanTarget.primary_target_name}
            </p>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search available players..."
            className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredAvailable.map((p) => (
              <button
                key={p.rank}
                onClick={() => draftPlayer(p, true)}
                className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left text-sm hover:border-emerald-500/50"
              >
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-white/40">({p.position}, rank {p.rank})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {complete && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">Mock draft complete.</p>
          <p className="text-emerald-200/80">
            {picksMade.filter((p) => p.pivoted).length} of your picks pivoted
            from your linked draft plan.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5">
            <tr>
              <th className="sticky left-0 bg-white/5 px-3 py-2">Rd</th>
              {Array.from({ length: setup.leagueSize }, (_, i) => i + 1).map((slot) => (
                <th key={slot} className="px-3 py-2 whitespace-nowrap">
                  {slot === setup.userDraftSlot ? "You" : seatToProfile[slot]?.name ?? `Slot ${slot}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: setup.rounds }, (_, i) => i + 1).map((round) => (
              <tr key={round} className="border-t border-white/10">
                <td className="sticky left-0 bg-black/40 px-3 py-2 font-medium">{round}</td>
                {Array.from({ length: setup.leagueSize }, (_, i) => i + 1).map((slot) => {
                  const pick = picksMade.find((p) => p.round === round && p.seat === slot);
                  return (
                    <td key={slot} className="px-3 py-2 whitespace-nowrap text-white/70">
                      {pick ? (
                        <span>
                          {pick.player.name}
                          {pick.player.rank === -1 && <span className="ml-1 text-emerald-400">🔒</span>}
                          {pick.pivoted && <span className="ml-1 text-yellow-400">*</span>}
                        </span>
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-white/40">
        * = pivoted from your linked draft plan
      </p>
    </div>
  );
}
