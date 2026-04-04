# Code Search MCP Server

1. Implement an MCP server exposing `read_file` and `search_code`.
2. Update `agent/.mcporter.json` to point at your server.
3. Run `bun run generate:code-search` in `agent/` to regenerate the typed client.
4. Rebuild with `npm run build` in `agent/`.
