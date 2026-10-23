"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizePlayerName } from "@/lib/players";

type Manager = { key: string; name: string };
type Candidate = {
  playerName: string;
  position: string | null;
  costRound: number;
  valueRound: number;
  surplus: number;
};
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

export default function KeeperHub({
  leagueId,
  managers,
  candidatesByManagerKey,
  recentPicks,
  existingKeepers,
}: {
  leagueId: string;
  managers: Manager[];
  candidatesByManagerKey: Record<string, Candidate[]>;
  recentPicks: RecentPick[];
  existingKeepers: Keeper[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [keepers, setKeepers] = useState<Keeper[]>(existingKeepers);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedManual, setExpandedManual] = useState<Set<string>>(new Set());
  const [manualForm, setManualForm] = useState<Record<string, { name: string; position: string; round: string }>>({});
  const [error, setError] = useState<string | null>(null);

  function keepersFor(managerKey: string) {
    return keepers.filter((k) => (k.sleeper_user_id ?? k.manager_name) === managerKey);
  }

  async function addKeeper(
    managerKey: string,
    managerName: string,
    playerName: string,
    position: string | null,
    round: number
  ) {
    setSavingKey(`${managerKey}-${playerName}`);
    setError(null);

    const isSleeperUserId = /^\d+$/.test(managerKey);

    const { data, error: insertError } = await supabase
      .from("keepers")
      .insert({
        league_id: leagueId,
        sleeper_user_id: isSleeperUserId ? managerKey : null,
        manager_name: managerName,
        player_name: playerName,
        player_position: position,
        round,
      })
      .select("id, sleeper_user_id, manager_name, player_name, player_position, round")
      .single();

    setSavingKey(null);

    if (insertError || !data) {
      setError(insertError?.message ?? "Could not save that keeper.");
      return;
    }

    setKeepers((prev) => [...prev, data]);
    router.refresh();
  }

  async function handleDelete(id: string) {
    await supabase.from("keepers").delete().eq("id", id);
    setKeepers((prev) => prev.filter((k) => k.id !== id));
    router.refresh();
  }

  function toggleManual(managerKey: string) {
    setExpandedManual((prev) => {
      const next = new Set(prev);
      if (next.has(managerKey)) next.delete(managerKey);
      else next.add(managerKey);
      return next;
    });
  }

  function updateManualForm(managerKey: string, field: "name" | "position" | "round", value: string) {
    setManualForm((prev) => {
      const existing = prev[managerKey] ?? { name: "", position: "", round: "" };
      return { ...prev, [managerKey]: { ...existing, [field]: value } };
    });
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {managers.map((manager) => {
          const candidates = candidatesByManagerKey[manager.key] ?? [];
          const managerKeepers = keepersFor(manager.key);
          const managerPicks = recentPicks.filter(
            (p) => (p.sleeper_user_id ?? p.manager_name) === manager.key
          );
          const form = manualForm[manager.key] ?? { name: "", position: "", round: "" };

          return (
            <div key={manager.key} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h2 className="mb-3 text-sm font-medium">{manager.name}</h2>

              {managerKeepers.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  {managerKeepers.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-300 mr-2">
                          Keeping
                        </span>
                        {k.player_name} {k.player_position ? `(${k.player_position})` : ""} · R{k.round}
                      </span>
                      <button
                        onClick={() => handleDelete(k.id)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {candidates.length > 0 ? (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
                    Best value candidates
                  </p>
                  <ul className="space-y-1.5">
                    {candidates
                      .filter((c) => !managerKeepers.some((k) => normalizePlayerName(k.player_name) === normalizePlayerName(c.playerName)))
                      .map((c) => (
                        <li key={c.playerName} className="flex items-center justify-between text-sm">
                          <span>
                            {c.playerName}
                            {c.position ? <span className="text-white/40"> ({c.position})</span> : null}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs ${c.surplus > 0 ? "text-emerald-400" : "text-white/40"}`}>
                              R{c.costRound}, worth ~R{c.valueRound}
                              {c.surplus > 0 ? ` (+${c.surplus})` : ""}
                            </span>
                            <button
                              onClick={() =>
                                addKeeper(manager.key, manager.name, c.playerName, c.position, c.costRound)
                              }
                              disabled={savingKey === `${manager.key}-${c.playerName}`}
                              className="rounded bg-emerald-500 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                            >
                              {savingKey === `${manager.key}-${c.playerName}` ? "..." : "Keep"}
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : (
                <p className="mb-3 text-xs text-white/40">
                  No value candidates found for this team yet.
                </p>
              )}

              <button
                onClick={() => toggleManual(manager.key)}
                className="text-xs text-white/40 hover:text-white/70 hover:underline"
              >
                {expandedManual.has(manager.key) ? "− Hide" : "+ Add a different keeper manually"}
              </button>

              {expandedManual.has(manager.key) && (
                <div className="mt-3 space-y-2 rounded-md bg-black/20 p-3">
                  {managerPicks.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {managerPicks.map((pick) => (
                        <button
                          key={`${pick.round}-${pick.player_name}`}
                          onClick={() => {
                            updateManualForm(manager.key, "name", pick.player_name);
                            updateManualForm(manager.key, "position", pick.player_position ?? "");
                            updateManualForm(manager.key, "round", String(pick.round));
                          }}
                          className="rounded border border-white/10 bg-black/20 px-2 py-1 text-xs hover:border-white/30"
                        >
                          R{pick.round}: {pick.player_name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Player name"
                      value={form.name}
                      onChange={(e) => updateManualForm(manager.key, "name", e.target.value)}
                      className="col-span-2 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none"
                    />
                    <input
                      type="number"
                      placeholder="Round"
                      value={form.round}
                      onChange={(e) => updateManualForm(manager.key, "round", e.target.value)}
                      className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Position (optional)"
                    value={form.position}
                    onChange={(e) => updateManualForm(manager.key, "position", e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none"
                  />
                  <button
                    onClick={() => {
                      if (!form.name || !form.round) return;
                      addKeeper(manager.key, manager.name, form.name, form.position || null, Number(form.round));
                      setManualForm((prev) => ({ ...prev, [manager.key]: { name: "", position: "", round: "" } }));
                    }}
                    className="w-full rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
                  >
                    Add this keeper
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
