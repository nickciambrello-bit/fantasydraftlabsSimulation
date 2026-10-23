import { redirect } from "next/navigation";

// The standalone Keeper Value page has been merged into the main Keepers
// page — this just forwards anyone who still has the old link bookmarked.
export default function KeeperValueRedirect({ params }: { params: { id: string } }) {
  redirect(`/leagues/${params.id}/keepers`);
}
