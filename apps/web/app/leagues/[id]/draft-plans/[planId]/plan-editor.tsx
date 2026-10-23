"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Round = {
  id: string;
  round: number;
  primary_target_name: string | null;
  primary_target_position: string | null;
  pivot_notes: string | null;
  notes: string | null;
};

export default function PlanEditor({
  planId,
  initialRounds,
}: {
  planId: string;
  initialRounds: Round[];
}) {
  const supabase = createClient();
  const [rounds, setRounds] = useState<Round[]>(initialRounds);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRound(index: number, field: keyof Round, value: string) {
    setRounds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value || null };
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const rows = rounds.map((r) => ({
      draft_plan_id: planId,
      round: r.round,
      primary_target_name: r.primary_target_name,
      primary_target_position: r.primary_target_position,
      pivot_notes: r.pivot_notes,
      notes: r.notes,
    }));

    const { error: upsertError } = await supabase
      .from("draft_plan_rounds")
      .upsert(rows, { onConflict: "draft_plan_id,round" });

    setSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setSaved(true);
  }

  return (
    <div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="mb-6 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save plan"}
      </button>
      {saved && <span className="ml-3 text-sm text-emerald-400">Saved.</span>}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="space-y-4">
        {rounds.map((round, i) => (
          <div key={round.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-sm font-medium">Round {round.round}</h3>

            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-white/50">Primary target</label>
                <input
                  type="text"
                  value={round.primary_target_name ?? ""}
                  onChange={(e) => updateRound(i, "primary_target_name", e.target.value)}
                  placeholder="Player name"
                  className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">Position</label>
                <input
                  type="text"
                  value={round.primary_target_position ?? ""}
                  onChange={(e) => updateRound(i, "primary_target_position", e.target.value)}
                  placeholder="e.g. RB"
                  className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs text-white/50">
                If gone, pivot to
              </label>
              <textarea
                value={round.pivot_notes ?? ""}
                onChange={(e) => updateRound(i, "pivot_notes", e.target.value)}
                rows={2}
                placeholder="e.g. RB: Player A · WR: Player B"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-white/50">Notes</label>
              <textarea
                value={round.notes ?? ""}
                onChange={(e) => updateRound(i, "notes", e.target.value)}
                rows={2}
                placeholder="Any other thoughts for this round"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
