# Code Search MCP Server

Set `DEMO_APP_ROOT` to the sibling Rails repo path before using the local demo
server:

```bash
export DEMO_APP_ROOT=/home/bjw/db-specialist-demo
```

1. Implement an MCP server exposing `read_file` and `search_code`.
2. Update `agent/.mcporter.json` to point at your server.
3. Run `bun run generate:code-search` in `agent/` to regenerate the typed client.
4. Rebuild with `npm run build` in `agent/`.
