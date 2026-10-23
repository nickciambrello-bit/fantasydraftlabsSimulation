import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StrategyLabClient from "./strategy-lab-client";

export default async function StrategyLabPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, sleeper_league_id, sleeper_username")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  const { data: settings } = await supabase
    .from("league_settings")
    .select("league_size")
    .eq("league_id", league.id)
    .single();

  const { data: rankingSources } = await supabase
    .from("ranking_sources")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href={`/leagues/${league.id}`} className="text-sm text-white/50 hover:underline">
        &larr; Back to league
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name} — Strategy Lab</h1>
      <p className="mb-6 text-sm text-white/60">
        Compare entire draft strategies, not just one pick — simulate whole
        drafts where your picks follow a named approach, and see how the
        resulting rosters stack up.
      </p>

      {!settings ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
          Confirm this league's settings first, from the league page.
        </p>
      ) : !rankingSources || rankingSources.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
          You'll need at least one ranking source first — go to Rankings.
        </p>
      ) : (
        <StrategyLabClient
          leagueId={league.id}
          sleeperLeagueId={league.sleeper_league_id}
          savedUsername={league.sleeper_username}
          leagueSize={settings.league_size}
          rankingSources={rankingSources}
        />
      )}
    </main>
  );
}
