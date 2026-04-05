// ABOUTME: Wires the DB specialist executor into an Express-hosted A2A service.
// ABOUTME: Exposes health, agent card, JSON-RPC, and REST endpoints for local use.
import express, { type Express } from "express";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { AGENT_CARD_PATH, type AgentCard } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
} from "@a2a-js/sdk/server/express";

import { DBSpecialistExecutor } from "./executor.ts";
import { createRuntimeExecutor } from "./runtime_dependencies.ts";

loadDotenv({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env"),
  override: false,
});

type ServerOptions = {
  baseUrl?: string;
  executor?: DBSpecialistExecutor;
  host?: string;
  port?: number;
};

export function createServer(options: ServerOptions = {}): {
  agentCard: AgentCard;
  app: Express;
  executor: DBSpecialistExecutor;
  requestHandler: DefaultRequestHandler;
} {
  const port = options.port ?? 3001;
  const baseUrl = options.baseUrl ?? `http://localhost:${port}`;
  const executor = options.executor ?? createRuntimeExecutor();
  const requestHandler = new DefaultRequestHandler(
    buildAgentCard(baseUrl),
    new InMemoryTaskStore(),
    executor,
  );
  const app = express();

  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(
    "/a2a/jsonrpc",
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
  );
  app.use(
    "/a2a/rest",
    restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
  );

  return { agentCard: buildAgentCard(baseUrl), app, executor, requestHandler };
}

export function startServer(options: ServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3001;
  const server = createServer({ ...options, port });

  return server.app.listen(port, host);
}

function buildAgentCard(baseUrl: string): AgentCard {
  return {
    name: "DB Specialist Agent",
    description: "Analyzes database offenders and reports findings.",
    protocolVersion: "0.3.0",
    version: "0.0.0",
    url: `${baseUrl}/a2a/jsonrpc`,
    skills: [
      {
        id: "analyze_db",
        name: "Analyze DB",
        description: "Inspect database findings and report the result.",
        tags: ["database", "analysis"],
      },
      {
        id: "analyze_table",
        name: "Analyze Table",
        description: "Inspect database findings scoped to a table and report the result.",
        tags: ["database", "analysis", "table"],
      },
    ],
    capabilities: {
      pushNotifications: false,
      streaming: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [
      { url: `${baseUrl}/a2a/jsonrpc`, transport: "JSONRPC" },
      { url: `${baseUrl}/a2a/rest`, transport: "HTTP+JSON" },
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? "3001"),
  });
}
