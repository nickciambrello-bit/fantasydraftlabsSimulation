import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LiveDraftClient from "./live-draft-client";

export default async function LiveDraftSessionPage({
  params,
}: {
  params: { id: string; sessionId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  const { data: session } = await supabase
    .from("draft_sessions")
    .select("id, ranking_source_id, draft_plan_id, draft_slot, status, manual_trade_overrides")
    .eq("id", params.sessionId)
    .eq("user_id", user.id)
    .single();

  if (!session) notFound();

  const { data: existingPicks } = await supabase
    .from("draft_session_picks")
    .select("round, overall_pick, seat, player_name, position, is_user_pick")
    .eq("session_id", session.id)
    .order("overall_pick", { ascending: true });

  let planRounds: Record<number, { primary_target_name: string | null; primary_target_position: string | null }> = {};
  if (session.draft_plan_id) {
    const { data: rounds } = await supabase
      .from("draft_plan_rounds")
      .select("round, primary_target_name, primary_target_position")
      .eq("draft_plan_id", session.draft_plan_id);
    for (const r of rounds ?? []) planRounds[r.round] = r;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <Link href={`/leagues/${league.id}/live-draft`} className="text-sm text-white/50 hover:underline">
        &larr; Back to sessions
      </Link>

      <h1 className="mb-6 mt-3 text-xl font-semibold">{league.name} — Live Draft</h1>

      <LiveDraftClient
        leagueId={league.id}
        sessionId={session.id}
        rankingSourceId={session.ranking_source_id}
        draftSlot={session.draft_slot}
        status={session.status}
        existingPicks={existingPicks ?? []}
        planRounds={planRounds}
        initialManualTrades={session.manual_trade_overrides ?? []}
      />
    </main>
  );
}
