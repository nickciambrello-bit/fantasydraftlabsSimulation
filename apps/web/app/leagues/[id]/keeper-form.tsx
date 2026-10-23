"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CostRule = "same_round" | "round_minus_n" | "flat_round" | "auction_value" | "other";

type ExistingSettings = {
  keeper_enabled: boolean;
  keeper_count: number;
  keeper_cost_rule: CostRule;
  keeper_cost_adjustment: number;
  keeper_notes: string | null;
  confirmed: boolean;
} | null;

export default function KeeperForm({
  leagueId,
  scoringType,
  scoringSettings,
  rosterPositions,
  leagueSize,
  draftType,
  existing,
}: {
  leagueId: string;
  scoringType: string;
  scoringSettings: Record<string, number>;
  rosterPositions: string[];
  leagueSize: number;
  draftType: string | null;
  existing: ExistingSettings;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [keeperEnabled, setKeeperEnabled] = useState(
    existing?.keeper_enabled ?? true
  );
  const [keeperCount, setKeeperCount] = useState(existing?.keeper_count ?? 1);
  const [costRule, setCostRule] = useState<CostRule>(
    existing?.keeper_cost_rule ?? "same_round"
  );
  const [adjustment, setAdjustment] = useState(
    existing?.keeper_cost_adjustment ?? 0
  );
  const [notes, setNotes] = useState(existing?.keeper_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const { error: upsertError } = await supabase
      .from("league_settings")
      .upsert(
        {
          league_id: leagueId,
          scoring_type: scoringType,
          scoring_settings: scoringSettings,
          roster_positions: rosterPositions,
          league_size: leagueSize,
          draft_type: draftType,
          keeper_enabled: keeperEnabled,
          keeper_count: keeperEnabled ? keeperCount : 0,
          keeper_cost_rule: costRule,
          keeper_cost_adjustment: adjustment,
          keeper_notes: notes || null,
          confirmed: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "league_id" }
      );

    setSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={keeperEnabled}
          onChange={(e) => setKeeperEnabled(e.target.checked)}
        />
        This league uses keepers
      </label>

      {keeperEnabled && (
        <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4">
          <div>
            <label className="mb-1 block text-white/60">
              Number of keepers allowed per team
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={keeperCount}
              onChange={(e) => setKeeperCount(Number(e.target.value))}
              className="w-24 rounded-md border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-white/30"
            />
          </div>

          <div>
            <label className="mb-1 block text-white/60">
              How keeper cost is calculated
            </label>
            <select
              value={costRule}
              onChange={(e) => setCostRule(e.target.value as CostRule)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-white/30"
            >
              <option value="same_round">
                Costs the same round they were drafted in last year
              </option>
              <option value="round_minus_n">
                Costs last year's round, minus N rounds
              </option>
              <option value="flat_round">
                Always costs a specific fixed round
              </option>
              <option value="auction_value">
                Based on auction value, not draft round
              </option>
              <option value="other">Other (describe below)</option>
            </select>
            <p className="mt-1 text-xs text-white/40">
              Your league: keeping a player costs your draft slot this year
              in the round they were drafted last year — that's "Costs the
              same round" with no adjustment.
            </p>
          </div>

          {costRule === "round_minus_n" && (
            <div>
              <label className="mb-1 block text-white/60">
                Rounds subtracted (e.g. 2 = a 4th-round pick last year costs
                a 2nd-round pick this year)
              </label>
              <input
                type="number"
                min={0}
                max={15}
                value={adjustment}
                onChange={(e) => setAdjustment(Number(e.target.value))}
                className="w-24 rounded-md border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-white/30"
              />
            </div>
          )}

          {costRule === "flat_round" && (
            <div>
              <label className="mb-1 block text-white/60">
                Fixed round every keeper costs
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={adjustment}
                onChange={(e) => setAdjustment(Number(e.target.value))}
                className="w-24 rounded-md border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-white/30"
              />
            </div>
          )}

          {costRule === "other" && (
            <div>
              <label className="mb-1 block text-white/60">
                Describe your keeper cost rule
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-white/30"
              />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-400">{error}</p>}
      {saved && !error && (
        <p className="text-emerald-400">Saved.</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Confirm settings"}
      </button>
    </form>
  );
}
