import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeletePlanButton from "./delete-plan-button";

export default async function DraftPlansPage({
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
    .select("id, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!league) notFound();

  const { data: plans } = await supabase
    .from("draft_plans")
    .select("id, name, draft_slot, created_at, updated_at")
    .eq("league_id", league.id)
    .order("updated_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href={`/leagues/${league.id}`} className="text-sm text-white/50 hover:underline">
        &larr; Back to league
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{league.name} — Draft Plans</h1>
      <p className="mb-6 text-sm text-white/60">
        Saved strategies you can edit and reference on draft day. Generate
        one from the Simulate page, then fine-tune it here.
      </p>

      <Link
        href={`/leagues/${league.id}/simulate`}
        className="mb-8 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
      >
        Run a simulation to build a plan &rarr;
      </Link>

      {(!plans || plans.length === 0) && (
        <p className="text-sm text-white/50">
          No saved plans yet — run a simulation and click "Save as Draft
          Plan" to create your first one.
        </p>
      )}

      <ul className="space-y-2">
        {(plans ?? []).map((plan) => (
          <li
            key={plan.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-white/30"
          >
            <Link href={`/leagues/${league.id}/draft-plans/${plan.id}`} className="flex-1">
              <p className="font-medium">{plan.name}</p>
              <p className="text-sm text-white/50">
                {plan.draft_slot ? `Slot ${plan.draft_slot} · ` : ""}
                Updated {new Date(plan.updated_at).toLocaleDateString()}
              </p>
            </Link>
            <DeletePlanButton planId={plan.id} />
          </li>
        ))}
      </ul>
    </main>
  );
}
