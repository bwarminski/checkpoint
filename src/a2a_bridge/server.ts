// ABOUTME: Converts A2A sends into pi session calls through the session registry.
// ABOUTME: Serializes work per context so same-context messages never run in parallel.
import { SessionRegistry } from "./session_registry.ts";

type AgentSession = {
  prompt(text: string): Promise<unknown>;
  sessionPath: string;
};

type BridgeInput = {
  createAgentSession(sessionPath?: string): Promise<AgentSession>;
  now?: () => Date;
  registry: SessionRegistry;
};

export function createA2ABridge(input: BridgeInput) {
  const queues = new Map<string, Promise<void>>();

  return {
    async send(contextId: string, text: string): Promise<unknown> {
      return runSerialized(queues, contextId, async () => {
        const existing = await input.registry.read(contextId);
        const session = await createSession(input, contextId, existing?.sessionPath);
        const timestamp = (input.now ?? (() => new Date()))().toISOString();

        await input.registry.record(contextId, {
          createdAt: existing?.createdAt ?? timestamp,
          lastActiveAt: timestamp,
          sessionPath: session.sessionPath,
        });

        return session.prompt(text);
      });
    },
  };
}

async function createSession(
  input: BridgeInput,
  contextId: string,
  sessionPath: string | undefined,
): Promise<AgentSession> {
  try {
    return await input.createAgentSession(sessionPath);
  } catch (error) {
    if (sessionPath === undefined) {
      throw error;
    }

    if (!isMissingSessionError(error)) {
      throw error;
    }

    await input.registry.remove(contextId);
    return input.createAgentSession();
  }
}

async function runSerialized<T>(
  queues: Map<string, Promise<void>>,
  contextId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(contextId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);

  queues.set(contextId, tail);
  await previous;

  try {
    return await work();
  } finally {
    release();
    if (queues.get(contextId) === tail) {
      queues.delete(contextId);
    }
  }
}

function isMissingSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /missing session|not found|enoent/i.test(error.message);
}
