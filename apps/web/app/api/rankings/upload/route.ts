import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSleeperPlayersLite, buildPlayerMatchIndex } from "@/lib/players";

type IncomingRow = {
  rank: number | null;
  adp: number | null;
  playerNameRaw: string;
  playerNameClean: string;
  position: string | null;
  team: string | null;
  byeWeek: number | null;
};

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json();
  const { name, rows }: { name: string; rows: IncomingRow[] } = body;

  if (!name || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "Missing a name or rows to import." },
      { status: 400 }
    );
  }

  try {
    const players = await fetchSleeperPlayersLite();
    const index = buildPlayerMatchIndex(players);

    const { data: source, error: sourceError } = await supabase
      .from("ranking_sources")
      .insert({ user_id: user.id, name, source_type: "upload" })
      .select("id")
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message ?? "Could not create ranking source.");
    }

    let matchedCount = 0;
    const entryRows = rows.map((row) => {
      const matched = index.match(row.playerNameClean, row.position);
      if (matched) matchedCount += 1;

      return {
        ranking_source_id: source.id,
        rank: row.rank,
        adp: row.adp,
        player_name_raw: row.playerNameRaw,
        player_name_clean: row.playerNameClean,
        position: row.position,
        team: row.team,
        bye_week: row.byeWeek,
        sleeper_player_id: matched?.player_id ?? null,
      };
    });

    // Insert in batches to stay well under request size limits.
    const BATCH_SIZE = 200;
    for (let i = 0; i < entryRows.length; i += BATCH_SIZE) {
      const batch = entryRows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from("ranking_entries")
        .insert(batch);
      if (insertError) throw new Error(insertError.message);
    }

    return NextResponse.json({
      success: true,
      sourceId: source.id,
      total: rows.length,
      matched: matchedCount,
      unmatched: rows.length - matchedCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Upload failed." },
      { status: 500 }
    );
  }
}
