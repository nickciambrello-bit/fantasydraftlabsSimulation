"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type RankingSource = { id: string; name: string };
type DraftPlan = { id: string; name: string };

export default function StartSessionForm({
  leagueId,
  sleeperLeagueId,
  savedUsername,
  leagueSize,
  rankingSources,
  draftPlans,
}: {
  leagueId: string;
  sleeperLeagueId: string;
  savedUsername: string | null;
  leagueSize: number;
  rankingSources: RankingSource[];
  draftPlans: DraftPlan[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [rankingSourceId, setRankingSourceId] = useState(rankingSources[0]?.id ?? "");
  const [draftPlanId, setDraftPlanId] = useState("");
  const [draftSlot, setDraftSlot] = useState(1);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        // Fall back to manual selection.
      }
    })();
  }, [savedUsername, sleeperLeagueId]);

  async function handleStart() {
    setStarting(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in.");
      setStarting(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("draft_sessions")
      .insert({
        league_id: leagueId,
        user_id: user.id,
        ranking_source_id: rankingSourceId,
        draft_plan_id: draftPlanId || null,
        draft_slot: draftSlot,
      })
      .select("id")
      .single();

    setStarting(false);

    if (insertError || !data) {
      setError(insertError?.message ?? "Could not start session.");
      return;
    }

    router.push(`/leagues/${leagueId}/live-draft/${data.id}`);
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 text-sm font-medium">Start a new live draft session</h2>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
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
            <option value="">None</option>
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

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <button
        onClick={handleStart}
        disabled={starting}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {starting ? "Starting..." : "Start live draft"}
      </button>
    </div>
  );
}
