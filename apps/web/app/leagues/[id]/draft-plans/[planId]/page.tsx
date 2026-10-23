import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PlanEditor from "./plan-editor";

export default async function DraftPlanPage({
  params,
}: {
  params: { id: string; planId: string };
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

  const { data: plan } = await supabase
    .from("draft_plans")
    .select("id, name, draft_slot")
    .eq("id", params.planId)
    .eq("user_id", user.id)
    .single();

  if (!plan) notFound();

  const { data: rounds } = await supabase
    .from("draft_plan_rounds")
    .select("id, round, primary_target_name, primary_target_position, pivot_notes, notes")
    .eq("draft_plan_id", plan.id)
    .order("round", { ascending: true });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href={`/leagues/${league.id}/draft-plans`} className="text-sm text-white/50 hover:underline">
        &larr; Back to draft plans
      </Link>

      <h1 className="mb-1 mt-3 text-xl font-semibold">{plan.name}</h1>
      <p className="mb-6 text-sm text-white/60">
        Edit any round below — this is your plan, not a fixed recommendation.
        Changes save when you click "Save plan."
      </p>

      <PlanEditor planId={plan.id} initialRounds={rounds ?? []} />
    </main>
  );
}
