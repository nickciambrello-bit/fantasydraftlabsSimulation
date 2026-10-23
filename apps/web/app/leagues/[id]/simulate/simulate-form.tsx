"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type RankingSource = { id: string; name: string };

type PositionSummary = Record<
  string,
  { avg_best_available_rank: number; pct_top_12: number; pct_top_24: number; pct_top_36: number }
>;

type PickResult = {
  round: number;
  overall_pick: number;
  locked?: boolean;
  top_available: { rank: number; name: string; position: string | null; availability_pct: number }[];
  position_summary: PositionSummary;
};

type Meta = {
  historySeasonsCount: number;
  leagueTendency: { position: string; earlyShare: number }[] | null;
  userDraftSlot: number;
  leagueSize: number;
  draftType: string;
  numSimulations: number;
  usedRealDraftOrder: boolean;
  userLockedRounds: { round: number; playerName: string; position: string | null }[];
  tradedPicksApplied: number;
};

type Finding = { title: string; explanation: string; action: string };
type Edge = { title: string; explanation: string; action: string } | null;
type BlueprintWindow = { window: string; text: string };

const CORE_POSITIONS = ["QB", "RB", "WR", "TE"];

function lockedInfoFor(meta: Meta, round: number) {
  return meta.userLockedRounds.find((l) => l.round === round) ?? null;
}

function pctColor(pct: number) {
  if (pct >= 60) return "bg-emerald-500/20 text-emerald-300";
  if (pct >= 25) return "bg-yellow-500/20 text-yellow-200";
  return "bg-red-500/20 text-red-300";
}

// --- Synthesis: turns raw round-by-round simulation output into the
// headline insights. All derived honestly from data already in `results` —
// nothing here is a fabricated or hardcoded recommendation.

function findBiggestCliff(results: PickResult[]) {
  let best: { i: number; pos: string; cur: number; next: number; drop: number } | null = null;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i].locked || results[i + 1].locked) continue;
    for (const pos of CORE_POSITIONS) {
      const cur = results[i].position_summary[pos]?.pct_top_12 ?? 0;
      if (cur < 15) continue;
      const next = results[i + 1].position_summary[pos]?.pct_top_12 ?? 0;
      const drop = cur - next;
      if (!best || drop > best.drop) best = { i, pos, cur, next, drop };
    }
  }
  return best && best.drop >= 20 ? best : null;
}

function computePickSpecificEdge(results: PickResult[]): Edge {
  const cliff = findBiggestCliff(results);
  if (!cliff) {
    return {
      title: "No sharp edge detected from your draft position",
      explanation:
        "Positional value looks fairly stable between your picks in these simulations — no single position both crashes and matters enough to force your hand.",
      action: "Stay flexible and take the best value on the board each round.",
    };
  }
  const pick = results[cliff.i];
  const next = results[cliff.i + 1];
  const picksBetween = next.overall_pick - pick.overall_pick - 1;

  return {
    title: `Don't leave Round ${pick.round} without a ${cliff.pos}`,
    explanation: `From your slot, ${picksBetween} other picks happen before you're back on the clock. In that gap, ${cliff.pos} availability at a top-12 level drops from ${cliff.cur}% to ${cliff.next}% by Round ${next.round}.`,
    action: `Secure your ${cliff.pos} by the end of Round ${pick.round}.`,
  };
}

function computeKeyFindings(results: PickResult[], leagueTendency: Meta["leagueTendency"]): Finding[] {
  const findings: Finding[] = [];

  const cliff = findBiggestCliff(results);
  if (cliff) {
    const pick = results[cliff.i];
    findings.push({
      title: `Prioritize ${cliff.pos} Early`,
      explanation: `${cliff.pos} availability at a top-12 level falls from ${cliff.cur}% to ${cliff.next}% between Round ${pick.round} and the next.`,
      action: `Secure your ${cliff.pos} by the end of Round ${pick.round}.`,
    });
  }

  // Best "safe to wait" position: whichever core position stays above 40%
  // top-12 availability the latest into the draft.
  let bestWait: { pos: string; round: number } | null = null;
  for (const pos of CORE_POSITIONS) {
    if (cliff && pos === cliff.pos) continue;
    let lastSafeRound = 0;
    for (const pick of results) {
      if ((pick.position_summary[pos]?.pct_top_12 ?? 0) >= 40) lastSafeRound = pick.round;
    }
    if (lastSafeRound >= 4 && (!bestWait || lastSafeRound > bestWait.round)) {
      bestWait = { pos, round: lastSafeRound };
    }
  }
  if (bestWait) {
    findings.push({
      title: `Wait on ${bestWait.pos}`,
      explanation: `${bestWait.pos} depth holds up well through Round ${bestWait.round} in these simulations.`,
      action: `Target ${bestWait.pos} value around Round ${bestWait.round} instead of reaching early.`,
    });
  }

  // League tendency finding, only if there's a real signal (meaningfully
  // above an even 25% split across the 4 core positions).
  const top = leagueTendency?.[0];
  if (top && top.earlyShare >= 35 && findings.length < 3) {
    findings.push({
      title: `Your League Leans ${top.position} Early`,
      explanation: `${top.position} accounts for ${top.earlyShare}% of all Round 1–3 picks in your league's synced history — well above an even split across QB/RB/WR/TE.`,
      action: `Expect a ${top.position} run early, and look for value forming at other positions while it happens.`,
    });
  }

  return findings.slice(0, 3);
}

function computeOpeningBlueprint(results: PickResult[], meta: Meta): BlueprintWindow[] {
  const windows: BlueprintWindow[] = [];

  const describe = (picks: PickResult[]) => {
    const positions = picks
      .filter((p) => !p.locked)
      .map((p) => p.top_available[0]?.position)
      .filter((p): p is string => Boolean(p));
    if (positions.length === 0) return "Best value available";
    const unique = Array.from(new Set(positions));
    return unique.join(" / ");
  };

  for (const pick of results.slice(0, 3)) {
    const locked = lockedInfoFor(meta, pick.round);
    windows.push({
      window: `Round ${pick.round}`,
      text: locked ? `${locked.playerName} (Keeper)` : describe([pick]),
    });
  }

  const rest = results.slice(3);
  const chunk = (start: number, end: number) => rest.filter((p) => p.round >= start && p.round <= end);

  const w1 = chunk(4, 5);
  if (w1.length > 0) windows.push({ window: "Rounds 4–5", text: describe(w1) });

  const w2 = chunk(6, 8);
  if (w2.length > 0) windows.push({ window: "Rounds 6–8", text: describe(w2) });

  const lastRound = results[results.length - 1]?.round ?? 0;
  const w3 = chunk(9, lastRound);
  if (w3.length > 0) windows.push({ window: `Rounds 9–${lastRound}`, text: "Best value / bench depth" });

  return windows;
}

function computeWhyThisWorks(leagueTendency: Meta["leagueTendency"], historySeasonsCount: number): string {
  const top = leagueTendency?.[0];
  if (!top || top.earlyShare < 30) {
    return `Based on your league's settings, rankings, draft position, and ${historySeasonsCount} season${historySeasonsCount === 1 ? "" : "s"} of history — no single position stands out as over- or under-drafted early in your league, so this plan leans on value and scarcity rather than a league-specific quirk.`;
  }
  const secondLeast = [...(leagueTendency ?? [])].sort((a, b) => a.earlyShare - b.earlyShare)[0];
  return `Across ${historySeasonsCount} season${historySeasonsCount === 1 ? "" : "s"} of your league's real drafts, ${top.position} has taken up ${top.earlyShare}% of all Round 1–3 picks — the highest share of any position, well above an even split. That tends to push ${secondLeast?.position ?? "other positions"} value later than you'd expect elsewhere, which is exactly the kind of gap this plan is built to exploit.`;
}

// Rough, clearly-labeled PPG curve keyed by OVERALL rank (not position
// rank — we don't have a cheap way to compute that from what's available
// at save time). Different positions get different slopes so the relative
// shape is still plausible, but treat this as a comparison tool between
// pivots, not a real projection — nothing in the app has actual player
// point projections yet.
function estimatePPG(position: string | null, overallRank: number): number {
  const curves: Record<string, { base: number; slope: number; floor: number }> = {
    QB: { base: 24, slope: 0.15, floor: 12 },
    RB: { base: 22, slope: 0.12, floor: 4 },
    WR: { base: 20, slope: 0.10, floor: 4 },
    TE: { base: 15, slope: 0.20, floor: 3 },
    K: { base: 8.5, slope: 0.01, floor: 6 },
    DEF: { base: 8, slope: 0.01, floor: 5 },
  };
  const c = curves[position ?? ""] ?? { base: 10, slope: 0.1, floor: 2 };
  return Math.max(c.floor, Math.round((c.base - c.slope * (overallRank - 1)) * 10) / 10);
}

function buildPlanRoundsFromResults(results: PickResult[], meta: Meta) {
  return results.map((pick, i) => {
    const locked = lockedInfoFor(meta, pick.round);
    if (locked) {
      return {
        round: pick.round,
        primary_target_name: locked.playerName,
        primary_target_position: locked.position,
        candidate_players: [],
        scarcity_insight: `Already locked in — this is your keeper (${locked.playerName}). No decision needed here.`,
        notes: null,
      };
    }

    const primary = pick.top_available[0];

    // A short, relevant list of realistic options for this pick — the
    // primary target plus the best available player at each other core
    // position, each with a rough PPG estimate attached. This is what the
    // plan editor later shows as clickable pivots.
    const candidates = [primary, ...CORE_POSITIONS
      .filter((pos) => pos !== primary?.position)
      .map((pos) => pick.top_available.find((p) => p.position === pos))]
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        name: p.name,
        position: p.position,
        rank: p.rank,
        availability_pct: p.availability_pct,
        estimated_ppg: estimatePPG(p.position, p.rank),
      }));

    const next = results[i + 1];
    let scarcityText = "No sharp cliffs detected this round — take the best value available.";
    if (next && !next.locked) {
      const drops = CORE_POSITIONS
        .map((pos) => {
          const cur = pick.position_summary[pos]?.pct_top_12 ?? 0;
          const nxt = next.position_summary[pos]?.pct_top_12 ?? 0;
          return { pos, cur, drop: cur - nxt };
        })
        .filter((d) => d.cur >= 15);
      const worst = drops.sort((a, b) => b.drop - a.drop)[0];
      if (worst && worst.drop >= 25) {
        scarcityText = `${worst.pos} tier drops off sharply after this pick — likely your window if you want a top-12 player there.`;
      } else {
        const safe = drops.filter((d) => d.cur >= 50 && d.drop < 15).map((d) => d.pos);
        if (safe.length > 0) {
          scarcityText = `${safe.join("/")} depth holds up fine into next round — safe to address another need here.`;
        }
      }
    }

    return {
      round: pick.round,
      primary_target_name: primary?.name ?? null,
      primary_target_position: primary?.position ?? null,
      candidate_players: candidates,
      scarcity_insight: scarcityText,
      notes: null,
    };
  });
}

export default function SimulateForm({
  leagueId,
  sleeperLeagueId,
  savedUsername,
  leagueSize,
  draftType,
  rankingSources,
}: {
  leagueId: string;
  sleeperLeagueId: string;
  savedUsername: string | null;
  leagueSize: number;
  draftType: string;
  rankingSources: RankingSource[];
}) {
  const supabase = createClient();
  const [rankingSourceId, setRankingSourceId] = useState(rankingSources[0]?.id ?? "");
  const [draftSlot, setDraftSlot] = useState(1);
  const [depth, setDepth] = useState(300);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PickResult[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const isRunningRef = useRef(false);

  const [sleeperUsername, setSleeperUsername] = useState(savedUsername ?? "");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectedSlot, setDetectedSlot] = useState<number | null>(null);
  const [showUsernameInput, setShowUsernameInput] = useState(!savedUsername);

  async function detectSlotFor(username: string) {
    setDetecting(true);
    setDetectError(null);
    setDetectedSlot(null);

    try {
      const userRes = await fetch(
        `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`
      );
      if (!userRes.ok) throw new Error("Sleeper username not found.");
      const sleeperUser = await userRes.json();
      if (!sleeperUser?.user_id) throw new Error("Sleeper username not found.");

      const draftsRes = await fetch(
        `https://api.sleeper.app/v1/league/${sleeperLeagueId}/drafts`
      );
      const drafts = await draftsRes.json();
      if (!drafts || drafts.length === 0) {
        throw new Error("No draft found for this league yet.");
      }

      const draftDetailRes = await fetch(
        `https://api.sleeper.app/v1/draft/${drafts[0].draft_id}`
      );
      const draftDetail = await draftDetailRes.json();

      const slot = draftDetail?.draft_order?.[sleeperUser.user_id];
      if (!slot) {
        throw new Error(
          "Sleeper doesn't have a draft order set for this league yet — the commissioner needs to set draft positions first. Pick your slot manually for now."
        );
      }

      setDetectedSlot(slot);
      setDraftSlot(slot);
      setShowUsernameInput(false);
      localStorage.setItem(`sleeper_username_${leagueId}`, username);

      // Save it permanently on the league too, so this never needs asking
      // again — not just remembered in this one browser.
      if (username !== savedUsername) {
        await supabase.from("leagues").update({ sleeper_username: username }).eq("id", leagueId);
      }
    } catch (err: any) {
      setDetectError(err.message ?? "Couldn't detect your slot.");
    } finally {
      setDetecting(false);
    }
  }

  function handleDetectSlot() {
    detectSlotFor(sleeperUsername);
  }

  // Prefer the username saved on the league (works across devices/browsers).
  // Fall back to a locally-remembered one, then auto-run detection
  // silently either way — no input shown unless we truly have nothing.
  useEffect(() => {
    const username = savedUsername || localStorage.getItem(`sleeper_username_${leagueId}`);
    if (username) {
      setSleeperUsername(username);
      detectSlotFor(username);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const draftTypeSupported = draftType === "snake" || draftType === "linear";

  async function handleRun() {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setLoading(true);
    setError(null);
    setResults(null);
    setMeta(null);
    setSavedPlanId(null);
    setPlanError(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rankingSourceId,
          userDraftSlot: draftSlot,
          numSimulations: depth,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Simulation failed.");
      setResults(data.picks);
      setMeta(data.meta);

      // Every simulation automatically becomes a draft plan — no separate
      // save step. You can still fully edit it afterward.
      await saveAsPlan(data.picks, data.meta);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
      isRunningRef.current = false;
    }
  }

  async function saveAsPlan(picks: PickResult[], meta: Meta) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in.");

      const simulationContext = `${meta.numSimulations} drafts simulated using your league's settings, ${meta.historySeasonsCount} season${meta.historySeasonsCount === 1 ? "" : "s"} of draft history, and your rankings — from Pick ${meta.userDraftSlot} of ${meta.leagueSize}. ${meta.usedRealDraftOrder ? "Used your league's real draft order." : "Draft order wasn't set yet, so opponents were randomly seated."}`;

      const { data: plan, error: planErr } = await supabase
        .from("draft_plans")
        .insert({
          league_id: leagueId,
          user_id: user.id,
          name: `Plan — Slot ${draftSlot} — ${new Date().toLocaleDateString()}`,
          draft_slot: draftSlot,
          ranking_source_id: rankingSourceId,
          simulation_context: simulationContext,
          draft_position: { slot: meta.userDraftSlot, teams: meta.leagueSize, format: meta.draftType },
          pick_specific_edge: computePickSpecificEdge(picks),
          key_findings: computeKeyFindings(picks, meta.leagueTendency),
          opening_blueprint: computeOpeningBlueprint(picks, meta),
          why_this_works: computeWhyThisWorks(meta.leagueTendency, meta.historySeasonsCount),
        })
        .select("id")
        .single();

      if (planErr || !plan) throw new Error(planErr?.message ?? "Could not create plan.");

      const rounds = buildPlanRoundsFromResults(picks, meta).map((r) => ({
        ...r,
        draft_plan_id: plan.id,
      }));

      const { error: roundsErr } = await supabase.from("draft_plan_rounds").insert(rounds);
      if (roundsErr) throw new Error(roundsErr.message);

      setSavedPlanId(plan.id);
    } catch (err: any) {
      setPlanError(err.message ?? "Simulation ran, but saving the plan failed.");
    }
  }

  if (!draftTypeSupported) {
    return (
      <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
        This league's draft type ("{draftType}") isn't supported by the
        simulator yet — only snake and linear drafts are, for now.
      </p>
    );
  }

  return (
    <div>
      {showUsernameInput ? (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-4">
          <label className="mb-1 block text-sm text-white/60">
            Detect your real draft slot
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={sleeperUsername}
              onChange={(e) => setSleeperUsername(e.target.value)}
              placeholder="Your Sleeper username"
              className="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
            />
            <button
              onClick={handleDetectSlot}
              disabled={detecting || !sleeperUsername}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-white/30 disabled:opacity-50"
            >
              {detecting ? "Checking..." : "Detect my slot"}
            </button>
          </div>
          {detectError && <p className="mt-2 text-sm text-yellow-300">{detectError}</p>}
          {detectedSlot && (
            <p className="mt-2 text-sm text-emerald-400">
              Found it — you're drafting from slot {detectedSlot}. Remembered
              for next time, you won't need to enter this again.
            </p>
          )}
          <p className="mt-2 text-xs text-white/40">
            Only works once your league's commissioner has set the draft
            order in Sleeper. Until then, just pick your slot manually below.
          </p>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm">
          <span className="text-white/60">
            {detecting
              ? "Checking your draft slot..."
              : detectedSlot
              ? `Drafting from slot ${detectedSlot}, detected via Sleeper (${sleeperUsername}).`
              : detectError
              ? detectError
              : `Using saved Sleeper username: ${sleeperUsername}.`}
          </span>
          <button
            onClick={() => setShowUsernameInput(true)}
            className="text-xs text-white/40 hover:text-white/70 hover:underline"
          >
            Not you? Change
          </button>
        </div>
      )}

      <div className="mb-6 grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4 sm:grid-cols-3">
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

        <div>
          <label className="mb-1 block text-sm text-white/60">Depth</label>
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
          >
            <option value={150}>Quick (150 sims)</option>
            <option value={300}>Standard (300 sims)</option>
            <option value={600}>Thorough (600 sims)</option>
            <option value={1000}>Very thorough (1000 sims)</option>
          </select>
        </div>
      </div>

      <p className="mb-4 text-xs text-white/40">
        This runs a Monte Carlo simulation — "depth" is how many random
        drafts it simulates. More simulations narrow the margin of error on
        every percentage below, similar to a poll: 150 gives a rough read,
        1000 gives a tighter one, at the cost of taking longer to run.
        Every run automatically saves as an editable draft plan.
      </p>

      <button
        onClick={handleRun}
        disabled={loading}
        className="mb-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {loading ? "Simulating... this can take a bit" : "Run simulation"}
      </button>

      {error && <p className="mb-6 text-sm text-red-400">{error}</p>}
      {planError && <p className="mb-6 text-sm text-yellow-300">{planError}</p>}

      {results && results.length > 0 && meta && (
        <ResultsView results={results} meta={meta} leagueId={leagueId} savedPlanId={savedPlanId} />
      )}
    </div>
  );
}

function ResultsView({
  results,
  meta,
  leagueId,
  savedPlanId,
}: {
  results: PickResult[];
  meta: Meta;
  leagueId: string;
  savedPlanId: string | null;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<"round" | "trajectory">("round");

  const edge = computePickSpecificEdge(results);
  const findings = computeKeyFindings(results, meta.leagueTendency);
  const blueprint = computeOpeningBlueprint(results, meta);
  const whyThisWorks = computeWhyThisWorks(meta.leagueTendency, meta.historySeasonsCount);
  const openingLine = results.slice(0, 3)
    .map((p) => {
      const locked = lockedInfoFor(meta, p.round);
      return locked ? `${locked.position ?? "Keeper"}*` : p.top_available[0]?.position ?? "value";
    })
    .join(" → ");

  return (
    <div className="space-y-8">
      {/* Simulation Context */}
      <p className="text-sm text-white/50">
        {meta.numSimulations} drafts simulated using your league settings,{" "}
        {meta.historySeasonsCount} season{meta.historySeasonsCount === 1 ? "" : "s"} of draft
        history, and your rankings — from Pick {meta.userDraftSlot} of {meta.leagueSize}.{" "}
        {meta.usedRealDraftOrder
          ? "Using your league's real draft order from Sleeper."
          : "Your league's draft order isn't set in Sleeper yet, so opponents were randomly seated."}
        {meta.tradedPicksApplied > 0 &&
          ` Accounting for ${meta.tradedPicksApplied} traded pick${meta.tradedPicksApplied === 1 ? "" : "s"} this season.`}
      </p>

      {/* Your Draft Plan (hero) */}
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-400">
          Your Draft Plan
        </h2>
        <p className="mb-2 text-2xl font-semibold">{openingLine}</p>
        <p className="text-sm text-white/60">
          Anchor your first few rounds here, then follow the blueprint below
          for the rest of the draft.
          {meta.userLockedRounds.length > 0 && " * = already locked in by a keeper."}
        </p>
      </section>

      {/* Pick-Specific Edge */}
      {edge && (
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">
            Your Pick-Specific Edge
          </h2>
          <p className="mb-2 text-lg font-medium">{edge.title}</p>
          <p className="mb-4 text-sm text-white/70">{edge.explanation}</p>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-400">
              Highest-impact action
            </p>
            <p className="text-sm text-emerald-200">{edge.action}</p>
          </div>
        </section>
      )}

      {/* Three Biggest Findings */}
      {findings.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/50">
            {findings.length === 3 ? "Three Biggest Findings" : "Biggest Findings"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {findings.map((f) => (
              <div key={f.title} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="mb-1 text-sm font-medium">{f.title}</p>
                <p className="mb-2 text-xs text-white/60">{f.explanation}</p>
                <p className="text-xs text-emerald-300">{f.action}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Opening Draft Blueprint */}
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/50">
          Opening Draft Blueprint
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {blueprint.map((w) => (
            <div key={w.window} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-white/50">{w.window}</p>
              <p className="text-sm font-medium">{w.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why This Works In Your League */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/50">
          Why This Works In Your League
        </h2>
        <p className="text-sm text-white/70">{whyThisWorks}</p>
      </section>

      {/* Draft Plan Activation */}
      {savedPlanId && (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">Draft Plan Saved ✓</p>
          <p className="text-emerald-200/80">
            This plan is saved and fully editable.{" "}
            <Link href={`/leagues/${leagueId}/draft-plans/${savedPlanId}`} className="underline">
              Open it &rarr;
            </Link>{" "}
            We haven't built the live Draft Room yet — that's next, and it'll
            use this plan once it exists.
          </p>
        </section>
      )}

      {/* Advanced Analysis (collapsed) */}
      <section>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="mb-3 text-sm text-white/50 hover:text-white/80"
        >
          {showAdvanced ? "− Hide" : "+ Show"} Advanced Analysis (raw round-by-round data)
        </button>

        {showAdvanced && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {results.map((p, i) => (
                  <button
                    key={p.overall_pick}
                    onClick={() => setActiveIndex(i)}
                    className={`rounded-md px-3 py-1.5 text-sm ${
                      view === "round" && i === activeIndex
                        ? "bg-emerald-500 font-medium text-black"
                        : "border border-white/10 bg-white/5 text-white/70 hover:border-white/30"
                    }`}
                  >
                    R{p.round}{p.locked ? " 🔒" : ""}
                  </button>
                ))}
              </div>
              <div className="flex rounded-md border border-white/10 bg-white/5 p-0.5 text-sm">
                <button
                  onClick={() => setView("round")}
                  className={`rounded px-3 py-1 ${view === "round" ? "bg-white/10 font-medium" : "text-white/60"}`}
                >
                  Round view
                </button>
                <button
                  onClick={() => setView("trajectory")}
                  className={`rounded px-3 py-1 ${view === "trajectory" ? "bg-white/10 font-medium" : "text-white/60"}`}
                >
                  Trajectory
                </button>
              </div>
            </div>

            {view === "trajectory" ? (
              <TrajectoryView results={results} />
            ) : (
              <RoundDetail pick={results[activeIndex]} locked={lockedInfoFor(meta, results[activeIndex].round)} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function RoundDetail({ pick, locked }: { pick: PickResult; locked: { playerName: string; position: string | null } | null }) {
  if (locked) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <h3 className="mb-2 text-sm font-medium">
          Round {pick.round} · Overall pick {pick.overall_pick}
        </h3>
        <p className="text-sm text-emerald-300">
          🔒 Locked in — this is your keeper: {locked.playerName}
          {locked.position ? ` (${locked.position})` : ""}. No decision needed here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-sm font-medium">
        Round {pick.round} · Overall pick {pick.overall_pick}
      </h3>

      <div className="mb-4">
        <h4 className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Most likely to still be available
        </h4>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/20">
              <tr>
                <th className="px-3 py-1.5">Rank</th>
                <th className="px-3 py-1.5">Player</th>
                <th className="px-3 py-1.5">Pos</th>
                <th className="px-3 py-1.5">Available %</th>
              </tr>
            </thead>
            <tbody>
              {pick.top_available.slice(0, 15).map((p) => (
                <tr key={p.rank} className="border-t border-white/10">
                  <td className="px-3 py-1.5">{p.rank}</td>
                  <td className="px-3 py-1.5">{p.name}</td>
                  <td className="px-3 py-1.5">{p.position ?? "—"}</td>
                  <td className="px-3 py-1.5 text-white/70">{p.availability_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Best remaining player, by position
        </h4>
        <div className="flex flex-wrap gap-2">
          {CORE_POSITIONS.filter((pos) => pick.position_summary[pos]).map((pos) => {
            const s = pick.position_summary[pos];
            return (
              <div key={pos} className={`rounded-md px-3 py-2 text-xs ${pctColor(s.pct_top_12)}`}>
                <span className="font-medium">{pos}</span>{" "}
                <span className="opacity-80">
                  avg rank {s.avg_best_available_rank} · {s.pct_top_12}% top-12
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrajectoryView({ results }: { results: PickResult[] }) {
  return (
    <div>
      <p className="mb-3 text-xs text-white/40">
        % chance a top-12 player at that position is still available at each
        of your picks. Green = safe to wait, yellow = thinning, red = mostly
        gone.
      </p>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/20">
            <tr>
              <th className="sticky left-0 bg-black/20 px-3 py-2">Position</th>
              {results.map((p) => (
                <th key={p.overall_pick} className="px-3 py-2 text-center whitespace-nowrap">
                  R{p.round}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORE_POSITIONS.map((pos) => (
              <tr key={pos} className="border-t border-white/10">
                <td className="sticky left-0 bg-black/40 px-3 py-2 font-medium">{pos}</td>
                {results.map((p) => {
                  const pct = p.position_summary[pos]?.pct_top_12 ?? 0;
                  return (
                    <td key={p.overall_pick} className="px-1 py-2 text-center">
                      <span className={`inline-block rounded px-2 py-1 ${pctColor(pct)}`}>
                        {pct}%
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
