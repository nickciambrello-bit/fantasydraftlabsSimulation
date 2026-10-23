import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import RankingViewClient from "./ranking-view-client";

export default async function RankingSourceDetailPage({
  params,
}: {
  params: { sourceId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: source } = await supabase
    .from("ranking_sources")
    .select("id, name")
    .eq("id", params.sourceId)
    .eq("user_id", user.id)
    .single();

  if (!source) notFound();

  const { data: entries } = await supabase
    .from("ranking_entries")
    .select("rank, adp, player_name_clean, position, team, bye_week, sleeper_player_id")
    .eq("ranking_source_id", source.id)
    .order("rank", { ascending: true, nullsFirst: false });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/rankings" className="text-sm text-white/50 hover:underline">
        &larr; Back to rankings
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{source.name}</h1>
      <p className="mb-6 text-sm text-white/60">
        {(entries ?? []).length} players — sorted by rank as stored (falls
        back to ADP if rank is missing). Search to check a specific player's
        exact value.
      </p>

      <RankingViewClient entries={entries ?? []} />
    </main>
  );
}
