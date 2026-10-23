"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
};

const CURRENT_SEASON = new Date().getFullYear().toString();
const SEASON_OPTIONS = [
  CURRENT_SEASON,
  (Number(CURRENT_SEASON) - 1).toString(),
  (Number(CURRENT_SEASON) - 2).toString(),
];

export default function ConnectSleeperPage() {
  const router = useRouter();
  const supabase = createClient();

  const [username, setUsername] = useState("");
  const [season, setSeason] = useState(CURRENT_SEASON);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLeagues([]);
    setSelected(new Set());
    setLoading(true);

    try {
      const userRes = await fetch(
        `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`
      );
      if (!userRes.ok) throw new Error("Sleeper username not found.");
      const sleeperUser = await userRes.json();
      if (!sleeperUser?.user_id) throw new Error("Sleeper username not found.");

      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${sleeperUser.user_id}/leagues/nfl/${season}`
      );
      if (!leaguesRes.ok) throw new Error("Could not load leagues for that season.");
      const leaguesData: SleeperLeague[] = await leaguesRes.json();

      if (leaguesData.length === 0) {
        setError(`No leagues found for "${username}" in ${season}.`);
      }
      setLeagues(leaguesData);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong looking up that username.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(leagueId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  }

  async function handleImport() {
    setSaving(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in.");
      setSaving(false);
      return;
    }

    const rowsToInsert = leagues
      .filter((l) => selected.has(l.league_id))
      .map((l) => ({
        user_id: user.id,
        sleeper_league_id: l.league_id,
        name: l.name,
        season: l.season,
        sleeper_username: username,
      }));

    const { error: insertError } = await supabase
      .from("leagues")
      .upsert(rowsToInsert, { onConflict: "user_id,sleeper_league_id" });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-1 text-xl font-semibold">Connect Sleeper</h1>
      <p className="mb-6 text-sm text-white/60">
        Enter your Sleeper username to find your leagues. No password needed
        — Sleeper&apos;s league data is public.
      </p>

      <form onSubmit={handleLookup} className="mb-6 flex gap-2">
        <input
          type="text"
          required
          placeholder="Sleeper username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
        <select
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-2 text-sm outline-none"
        >
          {SEASON_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Find leagues"}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {leagues.length > 0 && (
        <div>
          <ul className="mb-4 space-y-2">
            {leagues.map((l) => (
              <li
                key={l.league_id}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={selected.has(l.league_id)}
                  onChange={() => toggleSelected(l.league_id)}
                />
                <div>
                  <p className="font-medium">{l.name}</p>
                  <p className="text-sm text-white/50">Season {l.season}</p>
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={handleImport}
            disabled={selected.size === 0 || saving}
            className="w-full rounded-md bg-emerald-500 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            {saving
              ? "Importing..."
              : `Import ${selected.size || ""} league${
                  selected.size === 1 ? "" : "s"
                }`.trim()}
          </button>
        </div>
      )}
    </main>
  );
}
