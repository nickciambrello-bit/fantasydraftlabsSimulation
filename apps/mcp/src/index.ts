#!/usr/bin/env node
// Fantasy Labs MCP server (stdio). Add it to Claude Desktop; see apps/mcp/README.md.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  { name: "fantasy-labs", version: "0.1.0" },
  {
    instructions:
      "Fantasy football data tools. Every response has respondedAt and usually fetchedAt; mention them when data could be stale. " +
      "For waiver/start-sit questions combine game_lines (implied totals), game_weather, espn_injuries + espn_news (date-filtered), snap_counts and next_gen_stats. " +
      "For league-mate questions run league_history_sync first if league_history_status shows no data, then manager_tendencies.",
  },
);
registerTools(server);
await server.connect(new StdioServerTransport());
