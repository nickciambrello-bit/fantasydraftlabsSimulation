// ESPN's public (undocumented) site API. No key. Personal use only: ESPN can
// change these at any time, so every parser here is defensive.

import { fetchJson } from "../http.js";
import { findTeam, requireTeam } from "../teams.js";
import { nflverseDepthChart, type Opts } from "./nflverse.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SITE_WEB = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl";

const daysAgo = (iso: string | undefined) =>
  iso ? Math.round(((Date.now() - Date.parse(iso)) / 86_400_000) * 10) / 10 : null;

// ---------- injuries ----------

type EspnInjury = {
  status?: string;
  date?: string;
  shortComment?: string;
  longComment?: string;
  athlete?: { displayName?: string; position?: { abbreviation?: string } };
  details?: { type?: string; detail?: string; side?: string; returnDate?: string };
};
type EspnInjuryTeam = { id?: string; displayName?: string; injuries?: EspnInjury[] };

export function parseInjuries(
  data: { injuries?: EspnInjuryTeam[] },
  args: { team?: string; player?: string; maxAgeDays?: number; positions?: string[] },
) {
  const team = args.team ? requireTeam(args.team) : null;
  const maxAge = args.maxAgeDays ?? 10;
  const needle = args.player?.toLowerCase();
  const out = [];
  for (const t of data.injuries ?? []) {
    const tm = findTeam(t.id ?? "") ?? findTeam(t.displayName ?? "");
    if (team && tm?.abbr !== team.abbr) continue;
    for (const i of t.injuries ?? []) {
      const name = i.athlete?.displayName ?? "";
      const pos = i.athlete?.position?.abbreviation ?? "";
      if (needle && !name.toLowerCase().includes(needle)) continue;
      if (args.positions && !args.positions.includes(pos)) continue;
      const age = daysAgo(i.date);
      // Long-term IR entries keep an old date; still show them for a player lookup.
      if (!needle && age !== null && age > maxAge) continue;
      out.push({
        player: name,
        team: tm?.abbr ?? t.displayName,
        position: pos,
        status: i.status ?? null,
        injury: [i.details?.side, i.details?.type, i.details?.detail].filter(Boolean).join(" ") || null,
        expected_return: i.details?.returnDate ?? null,
        update: i.shortComment ?? null,
        updated_at: i.date ?? null,
        days_old: age,
      });
    }
  }
  return out.sort((a, b) => (a.days_old ?? 99) - (b.days_old ?? 99));
}

const FANTASY_POS = ["QB", "RB", "WR", "TE", "K", "FB"];

export async function espnInjuries(args: { team?: string; player?: string; maxAgeDays?: number; allPositions?: boolean }) {
  const url = `${SITE}/injuries`;
  const { data, fetchedAt } = await fetchJson<{ injuries?: EspnInjuryTeam[] }>(url);
  const rows = parseInjuries(data, { ...args, positions: args.allPositions ? undefined : FANTASY_POS });
  return {
    source: url,
    fetchedAt,
    filter: `updates from the last ${args.maxAgeDays ?? 10} days${args.player ? " (player lookups show all)" : ""}`,
    rows,
  };
}

// ---------- news ----------

type EspnArticle = {
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  type?: string;
  links?: { web?: { href?: string } };
  categories?: { type?: string; description?: string; teamId?: number; athleteId?: number }[];
};

export function parseNews(data: { articles?: EspnArticle[] }, args: { player?: string; maxAgeDays?: number }) {
  const maxAge = args.maxAgeDays ?? 3;
  const needle = args.player?.toLowerCase();
  return (data.articles ?? [])
    .map((a) => ({
      headline: a.headline ?? "",
      summary: a.description ?? "",
      published: a.published ?? a.lastModified ?? null,
      days_old: daysAgo(a.published ?? a.lastModified),
      players: (a.categories ?? []).filter((c) => c.type === "athlete").map((c) => c.description),
      teams: (a.categories ?? [])
        .filter((c) => c.type === "team")
        .map((c) => findTeam(String(c.teamId ?? ""))?.abbr ?? c.description),
      url: a.links?.web?.href ?? null,
    }))
    .filter((a) => a.days_old !== null && a.days_old <= maxAge)
    .filter(
      (a) =>
        !needle ||
        a.players.some((p) => p?.toLowerCase().includes(needle)) ||
        a.headline.toLowerCase().includes(needle) ||
        a.summary.toLowerCase().includes(needle),
    )
    .sort((a, b) => (a.days_old ?? 0) - (b.days_old ?? 0));
}

export async function espnNews(args: { team?: string; player?: string; maxAgeDays?: number }) {
  const team = args.team ? requireTeam(args.team) : null;
  const url = `${SITE}/news?limit=100${team ? `&team=${team.espnId}` : ""}`;
  const { data, fetchedAt } = await fetchJson<{ articles?: EspnArticle[] }>(url);
  const articles = parseNews(data, args);
  return {
    source: url,
    fetchedAt,
    filter: `published in the last ${args.maxAgeDays ?? 3} days`,
    count: articles.length,
    articles,
  };
}

// ---------- depth chart ----------

type EspnDepth = {
  depthchart?: {
    name?: string;
    positions?: Record<string, { position?: { abbreviation?: string }; athletes?: { displayName?: string }[] }>;
  }[];
};

export function parseDepthChart(data: EspnDepth) {
  const out: Record<string, string[]> = {};
  for (const formation of data.depthchart ?? []) {
    for (const [key, p] of Object.entries(formation.positions ?? {})) {
      const abbr = (p.position?.abbreviation ?? key).toUpperCase();
      if (!["QB", "RB", "WR", "TE", "K", "PK", "FB"].includes(abbr.replace(/\d/g, ""))) continue;
      const slot = out[abbr] ? `${abbr}${Object.keys(out).filter((k) => k.startsWith(abbr)).length + 1}` : abbr;
      out[slot] = (p.athletes ?? []).map((a) => a.displayName ?? "").filter(Boolean);
    }
  }
  return out;
}

export async function espnDepthChart(args: { team: string }, opts: Opts = {}) {
  const team = requireTeam(args.team);
  const url = `${SITE_WEB}/teams/${team.espnId}/depthcharts`;
  try {
    const { data, fetchedAt } = await fetchJson<EspnDepth>(url);
    const depthChart = parseDepthChart(data);
    if (Object.keys(depthChart).length) return { source: url, fetchedAt, team: team.abbr, depthChart };
  } catch {
    // fall through to nflverse's daily copy of ESPN depth charts
  }
  const fb = await nflverseDepthChart({ team: team.abbr }, opts);
  return { ...fb, note: "ESPN live depth chart unavailable; using nflverse's daily ESPN snapshot." };
}
