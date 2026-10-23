"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ImportSleeperDefaultButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRunningRef = useRef(false);

  async function handleImport() {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rankings/import-sleeper-default", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
      isRunningRef.current = false;
    }
  }

  return (
    <div>
      <button
        onClick={handleImport}
        disabled={loading}
        className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-white/30 disabled:opacity-50"
      >
        {loading ? "Importing..." : "Import Sleeper default"}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
