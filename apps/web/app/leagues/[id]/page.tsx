import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  fetchSleeperLeague,
  fetchSleeperDrafts,
  deriveScoringType,
  summarizeRosterPositions,
} from "@/lib/sleeper";
import KeeperForm from "./keeper-form";

export default async function LeagueDetailPage({
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
    .select("id, sleeper_league_id, name, season")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  // Pull live settings from Sleeper.
  const sleeperLeague = await fetchSleeperLeague(league.sleeper_league_id);
  const drafts = await fetchSleeperDrafts(league.sleeper_league_id);
  const latestDraft = drafts[0];

  const scoringType = deriveScoringType(sleeperLeague.scoring_settings);
  const rosterCounts = summarizeRosterPositions(sleeperLeague.roster_positions);

  const { data: existingSettings } = await supabase
    .from("league_settings")
    .select("*")
    .eq("league_id", league.id)
    .single();

  // Status for every step in the flow, so this page can act as the actual
  // hub instead of a flat list of links with no sense of progress.
  const { count: historySeasonsCount } = await supabase
    .from("league_history_seasons")
    .select("id", { count: "exact", head: true })
    .eq("league_id", league.id);

  const { count: rankingSourcesCount } = await supabase
    .from("ranking_sources")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const { count: keepersCount } = await supabase
    .from("keepers")
    .select("id", { count: "exact", head: true })
    .eq("league_id", league.id);

  const { count: draftPlansCount } = await supabase
    .from("draft_plans")
    .select("id", { count: "exact", head: true })
    .eq("league_id", league.id);

  const rosterEntries = Object.entries(rosterCounts).filter(
    ([pos]) => pos !== "BN"
  );
  const benchCount = rosterCounts["BN"] ?? 0;

  const settingsConfirmed = Boolean(existingSettings?.confirmed);
  const keeperLeague = Boolean(existingSettings?.keeper_enabled);
  const historyDone = (historySeasonsCount ?? 0) > 0;
  const rankingsDone = (rankingSourcesCount ?? 0) > 0;
  const keepersDone = (keepersCount ?? 0) > 0;
  const plansDone = (draftPlansCount ?? 0) > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/dashboard" className="text-sm text-white/50 hover:underline">
        &larr; Back to dashboard
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name}</h1>
      <p className="mb-8 text-sm text-white/60">Season {league.season}</p>

      {/* Step 1: Settings + keeper rule */}
      <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-white/50">
            1. League settings
          </h2>
          <StepBadge done={settingsConfirmed} doneLabel="Confirmed" pendingLabel="Review below" />
        </div>

        <dl className="mb-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-white/60">League size</dt>
            <dd>{sleeperLeague.total_rosters} teams</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Scoring</dt>
            <dd>{scoringType}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Draft type</dt>
            <dd className="capitalize">
              {latestDraft?.type ?? "Unknown"}
              {latestDraft?.settings?.rounds ? ` · ${latestDraft.settings.rounds} rounds` : ""}
            </dd>
          </div>
          <div>
            <dt className="mb-2 text-white/60">Roster</dt>
            <dd className="flex flex-wrap gap-2">
              {rosterEntries.map(([pos, count]) => (
                <span key={pos} className="rounded-md bg-black/30 px-2 py-1 text-xs">
                  {count}x {pos}
                </span>
              ))}
              <span className="rounded-md bg-black/30 px-2 py-1 text-xs">{benchCount}x Bench</span>
            </dd>
          </div>
        </dl>

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Keeper rule
        </h3>
        <KeeperForm
          leagueId={league.id}
          scoringType={scoringType}
          scoringSettings={sleeperLeague.scoring_settings}
          rosterPositions={sleeperLeague.roster_positions}
          leagueSize={sleeperLeague.total_rosters}
          draftType={latestDraft?.type ?? null}
          existing={existingSettings ?? null}
        />
      </section>

      {/* Step 2: History */}
      <StepCard
        step={2}
        title="League history"
        done={historyDone}
        doneLabel={`${historySeasonsCount} season${historySeasonsCount === 1 ? "" : "s"} synced`}
        pendingLabel="Not synced yet"
        description="Pulls and normalizes your league's real draft tendencies — the foundation everything else builds on."
        href={`/leagues/${league.id}/history`}
        cta="View history"
      />

      {/* Step 3: Rankings */}
      <StepCard
        step={3}
        title="Rankings"
        done={rankingsDone}
        doneLabel={`${rankingSourcesCount} source${rankingSourcesCount === 1 ? "" : "s"} available`}
        pendingLabel="None uploaded yet"
        description="Shared across all your leagues — upload once, use everywhere."
        href="/rankings"
        cta="Manage rankings"
      />

      {/* Step 4: Keepers — only if this league uses them */}
      {keeperLeague && (
        <StepCard
          step={4}
          title="Keepers"
          done={keepersDone}
          doneLabel={`${keepersCount} keeper${keepersCount === 1 ? "" : "s"} set`}
          pendingLabel="Not set yet"
          description="Log this league's keepers, or see the best-value keeper candidates per team."
          href={`/leagues/${league.id}/keepers`}
          cta="Manage keepers"
        />
      )}

      {/* Step 5: Simulate & Draft Plan */}
      <StepCard
        step={keeperLeague ? 5 : 4}
        title="Simulation & Draft Plan"
        done={plansDone}
        doneLabel={`${draftPlansCount} plan${draftPlansCount === 1 ? "" : "s"} saved`}
        pendingLabel="No plan yet"
        description="Know exactly what position to target at each pick — built from your league's history, scoring, and keepers."
        href={`/leagues/${league.id}/simulate`}
        cta="Run simulation"
        extraLink={{ href: `/leagues/${league.id}/draft-plans`, label: "View saved plans" }}
      />

      {/* Step 6: Mock Draft */}
      <StepCard
        step={keeperLeague ? 6 : 5}
        title="Mock draft"
        done={false}
        doneLabel=""
        pendingLabel="Practice anytime"
        description="Draft against your league's real tendencies, guided by your saved plan and rankings."
        href={`/leagues/${league.id}/mock-draft`}
        cta="Start mock draft"
      />

      <StepCard
        step={keeperLeague ? 7 : 6}
        title="Live draft room"
        done={false}
        doneLabel=""
        pendingLabel="Use on draft day"
        description="Track your real draft pick by pick, and compare candidate picks before you commit."
        href={`/leagues/${league.id}/live-draft`}
        cta="Open live draft room"
      />

      <StepCard
        step={keeperLeague ? 8 : 7}
        title="Strategy lab"
        done={false}
        doneLabel=""
        pendingLabel="Compare whole strategies"
        description="Simulate entire draft strategies (Hero RB, Zero RB, and more) end to end and compare the resulting rosters."
        href={`/leagues/${league.id}/strategy-lab`}
        cta="Open strategy lab"
      />

      <StepCard
        step={keeperLeague ? 9 : 8}
        title="League lab"
        done={false}
        doneLabel=""
        pendingLabel="Stress-test your plan"
        description="Adjust your league's behavior (RB/QB aggression, tendency strength) and see how sensitive your draft plan is."
        href={`/leagues/${league.id}/league-lab`}
        cta="Open league lab"
      />

      {/* Utility, not part of the main flow */}
      <div className="mt-6 text-center">
        <Link
          href={`/leagues/${league.id}/draft-board`}
          className="text-sm text-white/40 hover:text-white/70 hover:underline"
        >
          View live draft board (utility) &rarr;
        </Link>
      </div>
    </main>
  );
}

function StepBadge({
  done,
  doneLabel,
  pendingLabel,
}: {
  done: boolean;
  doneLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        done ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/50"
      }`}
    >
      {done ? doneLabel : pendingLabel}
    </span>
  );
}

function StepCard({
  step,
  title,
  done,
  doneLabel,
  pendingLabel,
  description,
  href,
  cta,
  extraLink,
}: {
  step: number;
  title: string;
  done: boolean;
  doneLabel: string;
  pendingLabel: string;
  description: string;
  href: string;
  cta: string;
  extraLink?: { href: string; label: string };
}) {
  return (
    <section className="mb-4 rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-white/50">
          {step}. {title}
        </h2>
        <StepBadge done={done} doneLabel={doneLabel} pendingLabel={pendingLabel} />
      </div>
      <p className="mb-4 text-sm text-white/60">{description}</p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={href}
          className="inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
        >
          {cta} &rarr;
        </Link>
        {extraLink && (
          <Link
            href={extraLink.href}
            className="inline-block rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-white/30"
          >
            {extraLink.label} &rarr;
          </Link>
        )}
      </div>
    </section>
  );
}
