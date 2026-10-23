"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteRankingButton({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this ranking source? This can't be undone.")) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/rankings/${sourceId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      router.refresh();
    } catch {
      alert("Couldn't delete that ranking source. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm text-red-400 hover:underline disabled:opacity-50"
    >
      {deleting ? "Deleting..." : "Delete"}
    </button>
  );
}
