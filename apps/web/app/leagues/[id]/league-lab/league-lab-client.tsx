"use client";

import { useEffect, useState } from "react";
import {
  simulateFullDraftTracking,
  aggregateStrategyResults,
  availabilityByPick,
  type StrategyAggregate,
} from "@fantasy-labs/engine";
import { applyLeagueLabSliders, type LeagueLabSliders } from "@fantasy-labs/engine";
import type { RankingRow, ManagerProfile } from "@fantasy-labs/engine";

type RankingSource = { id: string; name: string };

type SetupData = {
  leagueSize: number;
  draftType: string;
  rounds: number;
  rosterPositions: string[];
  rankings: RankingRow[];
  managerProfiles: ManagerProfile[];
  fixedSeatAssignments: Record<number, string> | null;
  userLockedRounds: { round: number; playerName: string; position: string | null }[];
};

export default function LeagueLabClient({
  leagueId,
  sleeperLeagueId,
  savedUsername,
  leagueSize,
  rankingSources,
}: {
  leagueId: string;
  sleeperLeagueId: string;
  savedUsername: string | null;
  leagueSize: number;
  rankingSources: RankingSource[];
}) {
  const [rankingSourceId, setRankingSourceId] = useState(rankingSources[0]?.id ?? "");
  const [draftSlot, setDraftSlot] = useState(1);
  const [sliders, setSliders] = useState<LeagueLabSliders>({
    rbAggression: 1,
    qbAggression: 1,
    tendencyStrength: 1,
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ baseline: StrategyAggregate; adjusted: StrategyAggregate } | null>(null);
  const [baselineTracking, setBaselineTracking] = useState<{
    pickTracking: Record<string, number[]>;
    userRoundConsensus: Record<number, Record<string, number>>;
  } | null>(null);
  const [adjustedTracking, setAdjustedTracking] = useState<typeof baselineTracking>(null);
  const [totalPicks, setTotalPicks] = useState(0);
  const [leagueSizeForGrid, setLeagueSizeForGrid] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState<{ name: string; source: "baseline" | "adjusted" } | null>(null);

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
        // Manual selection fallback.
      }
    })();
  }, [savedUsername, sleeperLeagueId]);

  async function runComparison() {
    setRunning(true);
    setError(null);
    setComparison(null);
    setBaselineTracking(null);
    setAdjustedTracking(null);
    setSelectedPlayer(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/mock-draft/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rankingSourceId, userDraftSlot: draftSlot }),
      });
      const setup: SetupData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(setup.error ?? "Could not load draft setup.");

      await new Promise((r) => setTimeout(r, 30));

      const userKeeperRounds = setup.userLockedRounds.map((l) => l.round);
      const adjustedProfiles = applyLeagueLabSliders(setup.managerProfiles, sliders);

      const baseline = simulateFullDraftTracking(
        setup.rankings, setup.managerProfiles, setup.leagueSize, setup.rounds,
        setup.draftType, draftSlot, setup.fixedSeatAssignments, userKeeperRounds, 100
      );
      const adjusted = simulateFullDraftTracking(
        setup.rankings, adjustedProfiles, setup.leagueSize, setup.rounds,
        setup.draftType, draftSlot, setup.fixedSeatAssignments, userKeeperRounds, 100
      );

      setComparison({
        baseline: aggregateStrategyResults(baseline.rosters, setup.rosterPositions),
        adjusted: aggregateStrategyResults(adjusted.rosters, setup.rosterPositions),
      });
      setBaselineTracking({ pickTracking: baseline.pickTracking, userRoundConsensus: baseline.userRoundConsensus });
      setAdjustedTracking({ pickTracking: adjusted.pickTracking, userRoundConsensus: adjusted.userRoundConsensus });
      setTotalPicks(setup.leagueSize * setup.rounds);
      setLeagueSizeForGrid(setup.leagueSize);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  function Slider({
    label, value, min, max, step, onChange, format,
  }: {
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; format: (v: number) => string;
  }) {
    return (
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-white/60">{label}</span>
          <span className="text-emerald-300">{format(value)}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-emerald-500"
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4 sm:grid-cols-2">
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

      <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-medium">Adjust your league's behavior</h2>
        <Slider
          label="RB aggression"
          value={sliders.rbAggression}
          min={0.5} max={2} step={0.1}
          onChange={(v) => setSliders((s) => ({ ...s, rbAggression: v }))}
          format={(v) => (v === 1 ? "Normal" : v < 1 ? `${Math.round((1 - v) * 100)}% lower` : `${Math.round((v - 1) * 100)}% higher`)}
        />
        <Slider
          label="QB aggression"
          value={sliders.qbAggression}
          min={0.5} max={2} step={0.1}
          onChange={(v) => setSliders((s) => ({ ...s, qbAggression: v }))}
          format={(v) => (v === 1 ? "Normal" : v < 1 ? `${Math.round((1 - v) * 100)}% lower` : `${Math.round((v - 1) * 100)}% higher`)}
        />
        <Slider
          label="Follow historical tendencies"
          value={sliders.tendencyStrength}
          min={0} max={1} step={0.1}
          onChange={(v) => setSliders((s) => ({ ...s, tendencyStrength: v }))}
          format={(v) => (v >= 0.9 ? "Strong" : v <= 0.1 ? "Loose" : `${Math.round(v * 100)}%`)}
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <button
        onClick={runComparison}
        disabled={running}
        className="mb-8 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {running ? "Simulating..." : "Compare baseline vs. adjusted"}
      </button>

      {comparison && (
        <div>
          <p className="mb-3 text-xs text-white/40">
            Rough, rank-based comparison — a stress test, not a prediction of how your league will actually behave.
          </p>
          <div className="mb-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h3 className="mb-2 text-sm font-medium text-white/60">Baseline (real tendencies)</h3>
              <p className="mb-2 text-2xl font-semibold text-emerald-300">{comparison.baseline.avgStartingPPG} <span className="text-sm text-white/40">est. PPG</span></p>
              <p className="text-xs text-white/50">{comparison.baseline.sampleOpening.join(", ")}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <h3 className="mb-2 text-sm font-medium text-white/60">Adjusted</h3>
              <p className="mb-2 text-2xl font-semibold text-emerald-300">{comparison.adjusted.avgStartingPPG} <span className="text-sm text-white/40">est. PPG</span></p>
              <p className="text-xs text-white/50">{comparison.adjusted.sampleOpening.join(", ")}</p>
            </div>
          </div>

          {baselineTracking && adjustedTracking && (
            <div className="mb-8">
              <h3 className="mb-2 text-sm font-medium">Common picks by round</h3>
              <p className="mb-3 text-xs text-white/40">
                Your most frequent landing spot each round, across all simulations. Click a player to see their availability across the whole draft.
              </p>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-3 py-2">Round</th>
                      <th className="px-3 py-2">Baseline</th>
                      <th className="px-3 py-2">Adjusted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.min(8, Math.max(
                      Object.keys(baselineTracking.userRoundConsensus).length,
                      Object.keys(adjustedTracking.userRoundConsensus).length
                    )) }, (_, i) => i + 1).map((round) => {
                      const topOf = (consensus: Record<number, Record<string, number>>) => {
                        const counts = consensus[round];
                        if (!counts) return null;
                        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                        if (entries.length === 0) return null;
                        const [name, count] = entries[0];
                        const total = Object.values(counts).reduce((a, b) => a + b, 0);
                        return { name, pct: Math.round((count / total) * 1000) / 10 };
                      };
                      const baseTop = topOf(baselineTracking.userRoundConsensus);
                      const adjTop = topOf(adjustedTracking.userRoundConsensus);
                      return (
                        <tr key={round} className="border-t border-white/10">
                          <td className="px-3 py-2 font-medium">{round}</td>
                          <td className="px-3 py-2">
                            {baseTop ? (
                              <button
                                onClick={() => setSelectedPlayer({ name: baseTop.name, source: "baseline" })}
                                className="text-emerald-300 hover:underline"
                              >
                                {baseTop.name} <span className="text-white/40">({baseTop.pct}%)</span>
                              </button>
                            ) : <span className="text-white/20">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {adjTop ? (
                              <button
                                onClick={() => setSelectedPlayer({ name: adjTop.name, source: "adjusted" })}
                                className="text-emerald-300 hover:underline"
                              >
                                {adjTop.name} <span className="text-white/40">({adjTop.pct}%)</span>
                              </button>
                            ) : <span className="text-white/20">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedPlayer && baselineTracking && adjustedTracking && (
        <PlayerAvailabilityModal
          playerName={selectedPlayer.name}
          initialSource={selectedPlayer.source}
          baselineTracking={baselineTracking.pickTracking}
          adjustedTracking={adjustedTracking.pickTracking}
          totalPicks={totalPicks}
          leagueSize={leagueSizeForGrid}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}

function pctColor(pct: number) {
  if (pct >= 80) return "bg-emerald-500/30 text-emerald-200";
  if (pct >= 50) return "bg-emerald-500/15 text-emerald-300";
  if (pct >= 20) return "bg-yellow-500/15 text-yellow-200";
  return "bg-red-500/15 text-red-300";
}

function PlayerAvailabilityModal({
  playerName,
  initialSource,
  baselineTracking,
  adjustedTracking,
  totalPicks,
  leagueSize,
  onClose,
}: {
  playerName: string;
  initialSource: "baseline" | "adjusted";
  baselineTracking: Record<string, number[]>;
  adjustedTracking: Record<string, number[]>;
  totalPicks: number;
  leagueSize: number;
  onClose: () => void;
}) {
  const [source, setSource] = useState<"baseline" | "adjusted">(initialSource);
  const tracking = source === "baseline" ? baselineTracking : adjustedTracking;
  const values = availabilityByPick(tracking, playerName, totalPicks);
  const rounds = Math.ceil(totalPicks / leagueSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-white/10 bg-black/95 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{playerName} — availability by pick</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70">✕</button>
        </div>

        <div className="mb-4 flex rounded-md border border-white/10 bg-white/5 p-0.5 text-sm w-fit">
          <button
            onClick={() => setSource("baseline")}
            className={`rounded px-3 py-1 ${source === "baseline" ? "bg-emerald-500 text-black" : "text-white/60"}`}
          >
            Baseline
          </button>
          <button
            onClick={() => setSource("adjusted")}
            className={`rounded px-3 py-1 ${source === "adjusted" ? "bg-emerald-500 text-black" : "text-white/60"}`}
          >
            Adjusted
          </button>
        </div>

        {values.length === 0 ? (
          <p className="text-sm text-white/50">No availability data for this player.</p>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
              <div key={round} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${leagueSize}, minmax(0, 1fr))` }}>
                {Array.from({ length: leagueSize }, (_, i) => i + 1).map((posInRound) => {
                  const overall = (round - 1) * leagueSize + posInRound;
                  const pct = values[overall - 1];
                  if (pct === undefined) return <div key={posInRound} />;
                  return (
                    <div
                      key={posInRound}
                      className={`rounded p-2 text-center text-xs ${pctColor(pct)}`}
                    >
                      <div className="text-[10px] opacity-70">
                        {round}.{String(posInRound).padStart(2, "0")}
                      </div>
                      <div className="font-semibold">{pct}%</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-white/30">
          % of simulations where this player was still available at that pick.
        </p>
      </div>
    </div>
  );
}
