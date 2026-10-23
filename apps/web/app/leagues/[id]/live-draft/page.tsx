import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StartSessionForm from "./start-session-form";

export default async function LiveDraftListPage({
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
    .select("league_size, draft_type")
    .eq("league_id", league.id)
    .single();

  const { data: rankingSources } = await supabase
    .from("ranking_sources")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data: draftPlans } = await supabase
    .from("draft_plans")
    .select("id, name")
    .eq("league_id", league.id)
    .order("updated_at", { ascending: false });

  const { data: sessions } = await supabase
    .from("draft_sessions")
    .select("id, status, draft_slot, created_at, updated_at")
    .eq("league_id", league.id)
    .order("updated_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href={`/leagues/${league.id}`} className="text-sm text-white/50 hover:underline">
        &larr; Back to league
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name} — Live Draft Room</h1>
      <p className="mb-6 text-sm text-white/60">
        Track your real draft pick by pick — not connected to Sleeper's live
        stream, so you enter each pick yourself. At your turn, compare a few
        candidate picks and see the simulated downstream consequence before
        you commit.
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
        <StartSessionForm
          leagueId={league.id}
          sleeperLeagueId={league.sleeper_league_id}
          savedUsername={league.sleeper_username}
          leagueSize={settings.league_size}
          rankingSources={rankingSources}
          draftPlans={draftPlans ?? []}
        />
      )}

      {sessions && sessions.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-white/50">
            Your sessions
          </h2>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/leagues/${league.id}/live-draft/${s.id}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-white/30"
                >
                  <span>
                    Slot {s.draft_slot} ·{" "}
                    <span className={s.status === "completed" ? "text-white/40" : "text-emerald-400"}>
                      {s.status === "completed" ? "Completed" : "In progress"}
                    </span>
                  </span>
                  <span className="text-xs text-white/40">
                    Updated {new Date(s.updated_at).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
