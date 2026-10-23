"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Manager = { key: string; name: string };
type RecentPick = {
  round: number;
  sleeper_user_id: string | null;
  manager_name: string;
  player_name: string;
  player_position: string | null;
};
type Keeper = {
  id: string;
  sleeper_user_id: string | null;
  manager_name: string;
  player_name: string;
  player_position: string | null;
  round: number;
};

function suggestRound(
  rule: string | null,
  adjustment: number,
  originalRound: number
): number | null {
  if (rule === "same_round") return originalRound;
  if (rule === "round_minus_n") return Math.max(1, originalRound - adjustment);
  if (rule === "flat_round") return adjustment;
  return null; // auction_value / other / unknown — no auto-suggestion
}

export default function KeeperManager({
  leagueId,
  managers,
  recentPicks,
  keeperRule,
  existingKeepers,
}: {
  leagueId: string;
  managers: Manager[];
  recentPicks: RecentPick[];
  keeperRule: { rule: string | null; adjustment: number };
  existingKeepers: Keeper[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [keepers, setKeepers] = useState<Keeper[]>(existingKeepers);
  const [selectedManagerKey, setSelectedManagerKey] = useState(managers[0]?.key ?? "");
  const [playerName, setPlayerName] = useState("");
  const [playerPosition, setPlayerPosition] = useState("");
  const [round, setRound] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picksForSelectedManager = useMemo(
    () =>
      recentPicks.filter(
        (p) => (p.sleeper_user_id ?? p.manager_name) === selectedManagerKey
      ),
    [recentPicks, selectedManagerKey]
  );

  function pickSuggestedPlayer(pick: RecentPick) {
    setPlayerName(pick.player_name);
    setPlayerPosition(pick.player_position ?? "");
    const suggested = suggestRound(keeperRule.rule, keeperRule.adjustment, pick.round);
    if (suggested !== null) setRound(suggested);
  }

  async function handleAdd() {
    if (!selectedManagerKey || !playerName || round === "") {
      setError("Pick a manager, player name, and round first.");
      return;
    }
    setSaving(true);
    setError(null);

    const manager = managers.find((m) => m.key === selectedManagerKey);
    const isSleeperUserId = /^\d+$/.test(selectedManagerKey);

    const { data, error: insertError } = await supabase
      .from("keepers")
      .insert({
        league_id: leagueId,
        sleeper_user_id: isSleeperUserId ? selectedManagerKey : null,
        manager_name: manager?.name ?? selectedManagerKey,
        player_name: playerName,
        player_position: playerPosition || null,
        round: Number(round),
      })
      .select("id, sleeper_user_id, manager_name, player_name, player_position, round")
      .single();

    setSaving(false);

    if (insertError || !data) {
      setError(insertError?.message ?? "Could not save that keeper.");
      return;
    }

    setKeepers((prev) => [...prev, data].sort((a, b) => a.round - b.round));
    setPlayerName("");
    setPlayerPosition("");
    setRound("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    await supabase.from("keepers").delete().eq("id", id);
    setKeepers((prev) => prev.filter((k) => k.id !== id));
    router.refresh();
  }

  return (
    <div>
      <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-white/50">
          Add a keeper
        </h2>

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-white/50">Manager</label>
            <select
              value={selectedManagerKey}
              onChange={(e) => setSelectedManagerKey(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            >
              {managers.map((m) => (
                <option key={m.key} value={m.key}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Round this keeper costs</label>
            <input
              type="number"
              min={1}
              value={round}
              onChange={(e) => setRound(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        {picksForSelectedManager.length > 0 && (
          <div className="mb-3">
            <label className="mb-1 block text-xs text-white/50">
              Or pick from their most recent draft (auto-fills name + suggested round)
            </label>
            <div className="flex flex-wrap gap-2">
              {picksForSelectedManager.map((pick) => (
                <button
                  key={`${pick.round}-${pick.player_name}`}
                  onClick={() => pickSuggestedPlayer(pick)}
                  className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs hover:border-white/30"
                >
                  R{pick.round}: {pick.player_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-white/50">Player name</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Position (optional)</label>
            <input
              type="text"
              value={playerPosition}
              onChange={(e) => setPlayerPosition(e.target.value)}
              placeholder="e.g. RB"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleAdd}
          disabled={saving}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Add keeper"}
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-white/50">
          This league's keepers
        </h2>
        {keepers.length === 0 ? (
          <p className="text-sm text-white/50">No keepers added yet.</p>
        ) : (
          <ul className="space-y-2">
            {keepers.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="font-medium">
                    {k.player_name} {k.player_position ? `(${k.player_position})` : ""}
                  </p>
                  <p className="text-sm text-white/50">
                    {k.manager_name} · Round {k.round}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(k.id)}
                  className="text-sm text-red-400 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
