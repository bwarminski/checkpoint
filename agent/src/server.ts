// ABOUTME: Wires the DB specialist executor into an Express-hosted A2A service.
// ABOUTME: Exposes health, agent card, JSON-RPC, and REST endpoints for local use.
import express, { type Express } from "express";
import { pathToFileURL } from "node:url";

import { AGENT_CARD_PATH, type AgentCard } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
} from "@a2a-js/sdk/server/express";

import { DBSpecialistExecutor } from "./executor.ts";

type ServerOptions = {
  baseUrl?: string;
  executor?: DBSpecialistExecutor;
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
  const executor = options.executor ?? new DBSpecialistExecutor();
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
  const port = options.port ?? 3001;
  const server = createServer({ ...options, port });

  return server.app.listen(port);
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
  startServer({ port: Number(process.env.PORT ?? "3001") });
}
