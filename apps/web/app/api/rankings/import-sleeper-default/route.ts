import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSleeperPlayersLite } from "@/lib/players";

const MAX_PLAYERS = 400;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const players = await fetchSleeperPlayersLite();

    const ranked = players
      .filter((p) => p.search_rank !== null && p.search_rank < 9999)
      .sort((a, b) => (a.search_rank ?? 0) - (b.search_rank ?? 0))
      .slice(0, MAX_PLAYERS);

    const { data: source, error: sourceError } = await supabase
      .from("ranking_sources")
      .insert({
        user_id: user.id,
        name: "Sleeper Default (search_rank)",
        source_type: "sleeper_default",
      })
      .select("id")
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message ?? "Could not create ranking source.");
    }

    const entryRows = ranked.map((player, index) => ({
      ranking_source_id: source.id,
      rank: index + 1,
      adp: null,
      player_name_raw: player.full_name,
      player_name_clean: player.full_name,
      position: player.position,
      team: player.team,
      bye_week: null,
      sleeper_player_id: player.player_id,
    }));

    const BATCH_SIZE = 200;
    for (let i = 0; i < entryRows.length; i += BATCH_SIZE) {
      const batch = entryRows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from("ranking_entries")
        .insert(batch);
      if (insertError) throw new Error(insertError.message);
    }

    return NextResponse.json({ success: true, sourceId: source.id, total: ranked.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Import failed." },
      { status: 500 }
    );
  }
}
