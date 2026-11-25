// Calls every data tool once through a real MCP client, so you can confirm
// each source works from your machine. Usage: pnpm --filter @fantasy-labs/mcp smoke
// Optional: SMOKE_ONLY=snap_counts,game_weather to run a subset.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--disable-warning=ExperimentalWarning", entry],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const calls = [
  ["game_lines", {}],
  ["game_weather", {}],
  ["espn_injuries", { team: "KC" }],
  ["espn_news", { max_age_days: 2 }],
  ["depth_chart", { team: "GB" }],
  ["snap_counts", { team: "DET", position: "WR" }],
  ["next_gen_stats", { kind: "receiving", limit: 5 }],
  ["injury_report", { team: "PHI" }],
  ["coverage_profile", { team: "SF", side: "defense", season: 2025 }],
  ["league_history_sync", {}],
  ["league_history_status", {}],
  ["manager_tendencies", {}],
];
const only = process.env.SMOKE_ONLY?.split(",");
let failed = 0;
for (const [name, args] of calls) {
  if (only && !only.includes(name)) continue;
  const t = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  const status = res.isError ? "FAIL" : "ok  ";
  if (res.isError) failed++;
  console.log(`${status} ${name.padEnd(22)} ${String(Date.now() - t).padStart(6)}ms  ${text.replace(/\s+/g, " ").slice(0, 160)}`);
}
await client.close();
process.exit(failed ? 1 : 0);
