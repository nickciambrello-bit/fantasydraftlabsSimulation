import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id, name, season")
    .eq("user_id", user.id)
    .order("season", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Fantasy Draft Labs</h1>
          <p className="text-sm text-white/60">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rankings"
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
          >
            Rankings
          </Link>
          <SignOutButton />
        </div>
      </div>

      {!leagues || leagues.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="mb-4 text-white/70">
            No leagues connected yet. Connect your Sleeper account to get
            started.
          </p>
          <Link
            href="/connect-sleeper"
            className="inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
          >
            Connect Sleeper
          </Link>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">Your leagues</h2>
            <Link
              href="/connect-sleeper"
              className="text-sm text-emerald-400 hover:underline"
            >
              + Connect another league
            </Link>
          </div>
          <ul className="space-y-2">
            {leagues.map((league) => (
              <li key={league.id}>
                <Link
                  href={`/leagues/${league.id}`}
                  className="block rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-white/30"
                >
                  <p className="font-medium">{league.name}</p>
                  <p className="text-sm text-white/50">
                    Season {league.season}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
