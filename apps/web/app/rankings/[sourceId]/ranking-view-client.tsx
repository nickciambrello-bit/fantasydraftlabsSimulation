"use client";

import { useMemo, useState } from "react";

type Entry = {
  rank: number | null;
  adp: number | null;
  player_name_clean: string;
  position: string | null;
  team: string | null;
  bye_week: number | null;
  sleeper_player_id: string | null;
};

export default function RankingViewClient({ entries }: { entries: Entry[] }) {
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [showOnlyNoRank, setShowOnlyNoRank] = useState(false);

  const noRankCount = useMemo(() => entries.filter((e) => e.rank === null).length, [entries]);
  const suspiciousAdpCount = useMemo(
    () => entries.filter((e) => e.rank === null && e.adp !== null && e.adp <= 0).length,
    [entries]
  );

  const positions = useMemo(() => {
    const set = new Set(entries.map((e) => e.position).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (showOnlyNoRank && e.rank !== null) return false;
      if (positionFilter && e.position !== positionFilter) return false;
      if (q && !e.player_name_clean.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, search, positionFilter, showOnlyNoRank]);

  return (
    <div>
      {noRankCount > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          {noRankCount} of {entries.length} players have no rank number, and fall back to ADP for
          sorting instead — {suspiciousAdpCount > 0 && (
            <strong>{suspiciousAdpCount} of those also have a zero or negative ADP</strong>
          )}{suspiciousAdpCount > 0 ? ", which sorts them incorrectly to the very front of the draft pool." : "."}
          <button
            onClick={() => setShowOnlyNoRank((v) => !v)}
            className="ml-2 underline hover:no-underline"
          >
            {showOnlyNoRank ? "Show all" : "Show only these rows"}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a player..."
          className="flex-1 min-w-[200px] rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
        <select
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
        >
          <option value="">All positions</option>
          {positions.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </div>

      <p className="mb-2 text-xs text-white/40">{filtered.length} shown</p>

      <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-black/80 backdrop-blur">
            <tr>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Pos</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">ADP</th>
              <th className="px-3 py-2">Matched to Sleeper</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className="px-3 py-2 font-medium">{e.rank ?? "—"}</td>
                <td className="px-3 py-2">{e.player_name_clean}</td>
                <td className="px-3 py-2 text-white/60">{e.position ?? "—"}</td>
                <td className="px-3 py-2 text-white/60">{e.team ?? "—"}</td>
                <td className="px-3 py-2 text-white/60">{e.adp ?? "—"}</td>
                <td className="px-3 py-2">
                  {e.sleeper_player_id ? (
                    <span className="text-emerald-400">Yes</span>
                  ) : (
                    <span className="text-yellow-400">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
