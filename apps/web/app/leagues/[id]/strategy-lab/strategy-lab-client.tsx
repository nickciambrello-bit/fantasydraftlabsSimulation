"use client";

import { useEffect, useState } from "react";
import {
  simulateStrategy,
  aggregateStrategyResults,
  STRATEGY_PRESETS,
  type StrategyAggregate,
} from "@fantasy-labs/engine";
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
  usedRealDraftOrder: boolean;
  userLockedRounds: { round: number; playerName: string; position: string | null }[];
};

const PRESET_KEYS = Object.keys(STRATEGY_PRESETS);

export default function StrategyLabClient({
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
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(["hero_rb", "zero_rb", "robust_rb", "balanced"]);
  const [depth, setDepth] = useState(150);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ key: string; label: string; aggregate: StrategyAggregate }[] | null>(null);

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

  function toggleStrategy(key: string) {
    setSelectedStrategies((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function runComparison() {
    if (selectedStrategies.length < 2) {
      setError("Pick at least 2 strategies to compare.");
      return;
    }
    setRunning(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/mock-draft/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rankingSourceId, userDraftSlot: draftSlot }),
      });
      const setup: SetupData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(setup.error ?? "Could not load draft setup.");

      // Give the browser a tick to paint "running" before the CPU-bound work.
      await new Promise((r) => setTimeout(r, 30));

      const userKeeperRounds = setup.userLockedRounds.map((l) => l.round);

      const out = selectedStrategies.map((key) => {
        const sims = simulateStrategy(
          key,
          setup.rankings,
          setup.managerProfiles,
          setup.leagueSize,
          setup.rounds,
          setup.draftType,
          draftSlot,
          setup.fixedSeatAssignments,
          userKeeperRounds,
          depth
        );
        const aggregate = aggregateStrategyResults(sims, setup.rosterPositions);
        return { key, label: STRATEGY_PRESETS[key].label, aggregate };
      });

      out.sort((a, b) => b.aggregate.avgStartingPPG - a.aggregate.avgStartingPPG);
      setResults(out);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

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
        <div>
          <label className="mb-1 block text-sm text-white/60">Depth</label>
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            <option value={50}>Quick (50 sims each)</option>
            <option value={150}>Standard (150 sims each)</option>
            <option value={500}>Thorough (500 sims each)</option>
            <option value={1000}>Very thorough (1000 sims each)</option>
          </select>
        </div>
      </div>

      <div className="mb-6">
        <label className="mb-2 block text-sm text-white/60">Strategies to compare (pick 2-4)</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESET_KEYS.map((key) => {
            const preset = STRATEGY_PRESETS[key];
            const selected = selectedStrategies.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleStrategy(key)}
                className={`rounded-lg border p-3 text-left text-sm ${
                  selected ? "border-emerald-500/50 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-xs text-white/50">{preset.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <button
        onClick={runComparison}
        disabled={running}
        className="mb-8 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {running ? "Simulating strategies..." : "Compare strategies"}
      </button>

      {results && (
        <div>
          <p className="mb-3 text-xs text-white/40">
            Rough, rank-based comparison — not a real point projection. Useful for comparing strategies against each other, not predicting your actual season.
          </p>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Est. starting lineup PPG</th>
                  <th className="px-3 py-2">Position mix (avg picks)</th>
                  <th className="px-3 py-2">Sample opening</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.key} className={`border-t border-white/10 ${i === 0 ? "bg-emerald-500/5" : ""}`}>
                    <td className="px-3 py-2 font-medium">
                      {r.label} {i === 0 && <span className="text-emerald-400">★</span>}
                    </td>
                    <td className="px-3 py-2 text-emerald-300">{r.aggregate.avgStartingPPG}</td>
                    <td className="px-3 py-2 text-white/60">
                      {Object.entries(r.aggregate.positionCounts)
                        .filter(([pos]) => ["QB", "RB", "WR", "TE"].includes(pos))
                        .map(([pos, count]) => `${pos}: ${count}`)
                        .join(" · ")}
                    </td>
                    <td className="px-3 py-2 text-white/60">{r.aggregate.sampleOpening.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
