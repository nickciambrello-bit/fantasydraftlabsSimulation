"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildPickOrder, type RankingRow, type ManagerProfile } from "@fantasy-labs/engine";
import { simulateNextPickOutlook, buildReasonText, type RemainingPick } from "@fantasy-labs/engine";

type SetupData = {
  leagueSize: number;
  draftType: string;
  rounds: number;
  rosterPositions: string[];
  rankings: RankingRow[];
  managerProfiles: ManagerProfile[];
  fixedSeatAssignments: Record<number, string> | null;
  usedRealDraftOrder: boolean;
  userLockedRounds: { round: number; playerName: string; position: string | null }[];
  allLockedRounds: { round: number; seat: number; playerName: string; position: string | null }[];
  roundSeatOverrides: Record<string, string>;
};

type ExistingPick = {
  round: number;
  overall_pick: number;
  seat: number;
  player_name: string;
  position: string | null;
  is_user_pick: boolean;
};

type PlanRound = { primary_target_name: string | null; primary_target_position: string | null };
type ManualTrade = { round: number; seat: number; newManagerName: string };

export default function LiveDraftClient({
  leagueId,
  sessionId,
  rankingSourceId,
  draftSlot,
  status,
  existingPicks,
  planRounds,
  initialManualTrades,
}: {
  leagueId: string;
  sessionId: string;
  rankingSourceId: string | null;
  draftSlot: number;
  status: string;
  existingPicks: ExistingPick[];
  planRounds: Record<number, PlanRound>;
  initialManualTrades: ManualTrade[];
}) {
  const supabase = createClient();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<ExistingPick[]>(existingPicks);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [manualTrades, setManualTrades] = useState<ManualTrade[]>(initialManualTrades);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeRound, setTradeRound] = useState(1);
  const [tradeSeat, setTradeSeat] = useState(1);
  const [tradeNewManager, setTradeNewManager] = useState("");
  const [pickLabRunning, setPickLabRunning] = useState(false);
  const [pickLabResults, setPickLabResults] = useState<
    { candidate: RankingRow; outlook: ReturnType<typeof simulateNextPickOutlook>["outlook"]; picksUntilNext: number; reason: { text: string; risk: "Low" | "Medium" | "High" } }[]
    | null
  >(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/mock-draft/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rankingSourceId, userDraftSlot: draftSlot }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load draft setup.");
        setSetup(data);
      } catch (err: any) {
        setLoadError(err.message ?? "Something went wrong loading setup.");
      }
    })();
  }, [leagueId, rankingSourceId, draftSlot]);

  const pickOrder = useMemo(
    () => (setup ? buildPickOrder(setup.leagueSize, setup.rounds, setup.draftType) : []),
    [setup]
  );

  const baseManagerBySeat = useMemo(() => {
    const map: Record<number, string> = {};
    if (!setup) return map;
    const byKey = new Map(setup.managerProfiles.map((p) => [p.key, p.name]));
    if (setup.fixedSeatAssignments) {
      for (const [seat, key] of Object.entries(setup.fixedSeatAssignments)) {
        map[Number(seat)] = byKey.get(key) ?? "Unknown";
      }
    }
    return map;
  }, [setup]);

  // Who's REALLY picking a given (round, seat) — checks a manually-recorded
  // mid-draft trade first, then this season's real Sleeper trades, then
  // falls back to whoever's normally in that seat.
  function effectiveManagerFor(round: number, seat: number): string {
    const manual = manualTrades.find((t) => t.round === round && t.seat === seat);
    if (manual) return manual.newManagerName;
    const overrideKey = setup?.roundSeatOverrides[`${round}-${seat}`];
    if (overrideKey) {
      const byKey = new Map(setup!.managerProfiles.map((p) => [p.key, p.name]));
      return byKey.get(overrideKey) ?? baseManagerBySeat[seat] ?? `Slot ${seat}`;
    }
    return baseManagerBySeat[seat] ?? `Slot ${seat}`;
  }

  function effectiveProfileFor(round: number, seat: number): ManagerProfile | null {
    if (!setup) return null;
    const byKey = new Map(setup.managerProfiles.map((p) => [p.key, p]));
    const manual = manualTrades.find((t) => t.round === round && t.seat === seat);
    if (manual) {
      const match = setup.managerProfiles.find((p) => p.name === manual.newManagerName);
      if (match) return match;
    }
    const overrideKey = setup.roundSeatOverrides[`${round}-${seat}`];
    if (overrideKey) return byKey.get(overrideKey) ?? null;
    const baseKey = setup.fixedSeatAssignments?.[seat];
    return baseKey ? byKey.get(baseKey) ?? null : null;
  }

  function isLockedForSeatRound(round: number, seat: number): boolean {
    return Boolean(setup?.allLockedRounds.some((l) => l.round === round && l.seat === seat));
  }

  const draftedCountsBySeatSoFar = useMemo(() => {
    const counts: Record<number, Record<string, number>> = {};
    for (const p of picks) {
      counts[p.seat] ??= {};
      const pos = p.position ?? "UNKNOWN";
      counts[p.seat][pos] = (counts[p.seat][pos] ?? 0) + 1;
    }
    return counts;
  }, [picks]);

  async function runPickLab() {
    if (!setup) return;
    setPickLabRunning(true);
    setPickLabResults(null);

    // Candidates: best overall available, plus best available at each
    // other core position — the realistic set of "what would I actually
    // consider here."
    const CORE = ["QB", "RB", "WR", "TE"];
    const primary = available[0];
    const candidates = [primary, ...CORE.filter((pos) => pos !== primary?.position).map((pos) =>
      available.find((p) => p.position === pos)
    )].filter((p): p is RankingRow => Boolean(p));

    const remainingPicks: RemainingPick[] = pickOrder.slice(pickIndex + 1).map((seat, i) => ({
      round: Math.floor((pickIndex + 1 + i) / setup.leagueSize) + 1,
      seat,
    }));

    // Give the browser a tick to paint the "running" state before the
    // (synchronous, CPU-bound) simulation work begins.
    await new Promise((r) => setTimeout(r, 30));

    const results = candidates.map((candidate) => {
      const { outlook, picksUntilNext } = simulateNextPickOutlook(
        candidate,
        available,
        remainingPicks,
        effectiveProfileFor,
        isLockedForSeatRound,
        draftSlot,
        draftedCountsBySeatSoFar,
        150
      );
      const reason = buildReasonText(candidate, outlook, picksUntilNext);
      return { candidate, outlook, picksUntilNext, reason };
    });

    setPickLabResults(results);
    setPickLabRunning(false);
  }

  const takenNames = useMemo(
    () => new Set(picks.map((p) => p.player_name.trim().toLowerCase())),
    [picks]
  );

  const available = useMemo(() => {
    if (!setup) return [];
    return setup.rankings.filter((r) => !takenNames.has(r.name.trim().toLowerCase()));
  }, [setup, takenNames]);

  const pickIndex = picks.length;
  const complete = setup !== null && pickIndex >= pickOrder.length;
  const currentSeat = pickOrder[pickIndex];
  const currentRound = setup ? Math.floor(pickIndex / setup.leagueSize) + 1 : 0;
  const isUserTurn = setup !== null && !complete && currentSeat === draftSlot;

  // Locked-round detection now covers EVERY manager's keeper, not just the
  // signed-in user's — otherwise hitting another manager's keeper round
  // would leave you stuck (that player's already excluded from search).
  const currentLockedInfo = setup?.allLockedRounds.find(
    (l) => l.round === currentRound && l.seat === currentSeat
  ) ?? null;

  // Keeper cells not yet reached, for the board overlay.
  const keeperByRoundSeat = useMemo(() => {
    const map = new Map<string, { playerName: string; position: string | null }>();
    for (const l of setup?.allLockedRounds ?? []) {
      map.set(`${l.round}-${l.seat}`, { playerName: l.playerName, position: l.position });
    }
    return map;
  }, [setup]);

  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase();
    // No artificial cap when searching — you should be able to find anyone
    // in your rankings. Only the default (empty search) view is trimmed,
    // since showing 400 rows with nothing typed isn't useful either.
    const pool = q ? available.filter((p) => p.name.toLowerCase().includes(q)) : available;
    return pool.slice(0, q ? 200 : 30);
  }, [available, search]);

  async function recordPick(name: string, position: string | null) {
    if (!setup || saving) return;
    setSaving(true);

    const seat = currentSeat;
    const round = currentRound;

    const { error } = await supabase.from("draft_session_picks").insert({
      session_id: sessionId,
      round,
      overall_pick: pickIndex + 1,
      seat,
      player_name: name,
      position,
      is_user_pick: seat === draftSlot,
    });

    if (!error) {
      const newPicks = [
        ...picks,
        { round, overall_pick: pickIndex + 1, seat, player_name: name, position, is_user_pick: seat === draftSlot },
      ];
      setPicks(newPicks);
      setSearch("");

      await supabase
        .from("draft_sessions")
        .update({
          updated_at: new Date().toISOString(),
          status: newPicks.length >= pickOrder.length ? "completed" : "in_progress",
        })
        .eq("id", sessionId);
    }

    setSaving(false);
  }

  async function recordTrade() {
    if (!tradeNewManager) return;
    const next = [...manualTrades, { round: tradeRound, seat: tradeSeat, newManagerName: tradeNewManager }];
    setManualTrades(next);
    setShowTradeForm(false);
    setTradeNewManager("");
    await supabase.from("draft_sessions").update({ manual_trade_overrides: next }).eq("id", sessionId);
  }

  if (loadError) {
    return <p className="text-sm text-red-400">{loadError}</p>;
  }

  if (!setup) {
    return <p className="text-sm text-white/50">Loading draft setup...</p>;
  }

  const currentPlanTarget = planRounds[currentRound];
  const allManagerNames = Array.from(new Set(setup.managerProfiles.map((p) => p.name)));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60">
        <span>
          {setup.usedRealDraftOrder ? "Using your league's real draft order. " : "Draft order not set in Sleeper — showing generic slots. "}
          {status === "completed" || complete
            ? "Draft complete."
            : `Round ${currentRound} of ${setup.rounds} — on the clock: ${currentSeat === draftSlot ? "You" : effectiveManagerFor(currentRound, currentSeat)}`}
        </span>
        <button
          onClick={() => setShowTradeForm((v) => !v)}
          className="text-xs text-white/40 hover:text-white/70 hover:underline"
        >
          {showTradeForm ? "Cancel" : "Record a mid-draft trade"}
        </button>
      </div>

      {showTradeForm && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="mb-3 text-sm text-yellow-200">
            Someone traded picks mid-draft? Record it here — this only
            updates labels in this session, not Sleeper itself.
          </p>
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-white/50">From round</label>
              <input
                type="number"
                min={1}
                max={setup.rounds}
                value={tradeRound}
                onChange={(e) => setTradeRound(Number(e.target.value))}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Original slot</label>
              <select
                value={tradeSeat}
                onChange={(e) => setTradeSeat(Number(e.target.value))}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              >
                {Array.from({ length: setup.leagueSize }, (_, i) => i + 1).map((s) => (
                  <option key={s} value={s}>Slot {s} ({baseManagerBySeat[s] ?? "Unknown"})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Now belongs to</label>
              <select
                value={tradeNewManager}
                onChange={(e) => setTradeNewManager(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              >
                <option value="">Select manager...</option>
                {allManagerNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={recordTrade}
            disabled={!tradeNewManager}
            className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-400 disabled:opacity-50"
          >
            Save trade
          </button>
          {manualTrades.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-white/50">
              {manualTrades.map((t, i) => (
                <li key={i}>
                  Round {t.round}, Slot {t.seat} &rarr; {t.newManagerName}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!complete && currentLockedInfo && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="mb-2 text-sm text-emerald-300">
            🔒 {currentSeat === draftSlot ? "This round is your keeper" : `${effectiveManagerFor(currentRound, currentSeat)}'s keeper this round`}: {currentLockedInfo.playerName}
            {currentLockedInfo.position ? ` (${currentLockedInfo.position})` : ""}
          </p>
          <button
            onClick={() => recordPick(currentLockedInfo.playerName, currentLockedInfo.position)}
            disabled={saving}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            Log keeper pick
          </button>
        </div>
      )}

      {!complete && !currentLockedInfo && (
        <div className={`mb-6 rounded-lg border p-4 ${isUserTurn ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-white/5"}`}>
          <h2 className="mb-2 text-sm font-medium">
            {isUserTurn ? "Your pick" : `Record ${effectiveManagerFor(currentRound, currentSeat)}'s pick`} — Round {currentRound}
          </h2>

          {isUserTurn && currentPlanTarget?.primary_target_name && (
            <p className="mb-3 text-sm text-emerald-300">
              Your plan says: {currentPlanTarget.primary_target_position} — {currentPlanTarget.primary_target_name}
            </p>
          )}

          {isUserTurn && (
            <div className="mb-4">
              <button
                onClick={runPickLab}
                disabled={pickLabRunning}
                className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {pickLabRunning ? "Simulating..." : "Simulate this pick (Pick Lab)"}
              </button>

              {pickLabResults && (
                <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-black/20">
                      <tr>
                        <th className="px-3 py-2">Candidate</th>
                        <th className="px-3 py-2">Rank</th>
                        <th className="px-3 py-2">Risk</th>
                        <th className="px-3 py-2">Why</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickLabResults.map((r) => (
                        <tr key={r.candidate.rank} className="border-t border-white/10 align-top">
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            {r.candidate.name} <span className="text-white/40">({r.candidate.position})</span>
                          </td>
                          <td className="px-3 py-2 text-white/70">{r.candidate.rank}</td>
                          <td className="px-3 py-2">
                            <span className={
                              r.reason.risk === "Low" ? "text-emerald-400" :
                              r.reason.risk === "Medium" ? "text-yellow-300" : "text-red-400"
                            }>
                              {r.reason.risk}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-white/70 max-w-md">{r.reason.text}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => recordPick(r.candidate.name, r.candidate.position)}
                              className="rounded bg-emerald-500 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400"
                            >
                              Take
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="p-3 text-xs text-white/30">
                    Based on 150 branch simulations per candidate, using your league's real tendencies, keepers, and any trades recorded. Reasoning wording is an early pass — the underlying simulation is real.
                  </p>
                </div>
              )}
            </div>
          )}

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all your ranked players..."
            className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
          />
          <p className="mb-2 text-xs text-white/30">
            {search
              ? `${filteredAvailable.length} match${filteredAvailable.length === 1 ? "" : "es"} shown (of ${available.length} available)`
              : `Showing the ${filteredAvailable.length} best remaining by rank, scroll for more — or type to search all ${available.length} available`}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 max-h-96 overflow-y-auto">
            {filteredAvailable.map((p) => (
              <button
                key={p.rank}
                onClick={() => recordPick(p.name, p.position)}
                disabled={saving}
                className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left text-sm hover:border-emerald-500/50 disabled:opacity-50"
              >
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-white/40">({p.position ?? "—"}, rank {p.rank})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {complete && (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          Draft complete — {picks.length} picks recorded.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5">
            <tr>
              <th className="sticky left-0 bg-white/5 px-3 py-2">Rd</th>
              {Array.from({ length: setup.leagueSize }, (_, i) => i + 1).map((slot) => (
                <th key={slot} className="px-3 py-2 whitespace-nowrap">
                  {slot === draftSlot ? "You" : baseManagerBySeat[slot] ?? `Slot ${slot}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: setup.rounds }, (_, i) => i + 1).map((round) => (
              <tr key={round} className="border-t border-white/10">
                <td className="sticky left-0 bg-black/40 px-3 py-2 font-medium">{round}</td>
                {Array.from({ length: setup.leagueSize }, (_, i) => i + 1).map((slot) => {
                  const pick = picks.find((p) => p.round === round && p.seat === slot);
                  const keeper = !pick ? keeperByRoundSeat.get(`${round}-${slot}`) : undefined;
                  const manualTrade = !pick ? manualTrades.find((t) => t.round === round && t.seat === slot) : undefined;
                  const seasonTrade = !pick && !manualTrade ? setup.roundSeatOverrides[`${round}-${slot}`] : undefined;

                  return (
                    <td key={slot} className="px-3 py-2 whitespace-nowrap text-white/70">
                      {pick ? (
                        `${pick.player_name}${pick.position ? ` (${pick.position})` : ""}`
                      ) : keeper ? (
                        <span className="text-emerald-300">
                          🔒 {keeper.playerName}{keeper.position ? ` (${keeper.position})` : ""}
                        </span>
                      ) : manualTrade ? (
                        <span className="text-yellow-300">🔄 {manualTrade.newManagerName}</span>
                      ) : seasonTrade ? (
                        <span className="text-yellow-300">🔄 traded</span>
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
    </div>
  );
}
