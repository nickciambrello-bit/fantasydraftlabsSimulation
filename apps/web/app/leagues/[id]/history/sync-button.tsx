"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncHistoryButton({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRunningRef = useRef(false);

  async function handleSync() {
    // Guards against double-clicks firing two overlapping syncs, which would
    // otherwise both delete-then-reinsert at the same time and duplicate rows.
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    setSyncing(true);
    setError(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/sync-history`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Sync failed.");
      }

      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setSyncing(false);
      isRunningRef.current = false;
    }
  }

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
      >
        {syncing ? "Syncing history... this can take a minute" : "Sync league history"}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
