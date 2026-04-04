// ABOUTME: Runs the DB specialist task lifecycle for the agent service.
// ABOUTME: Bridges the plan's simple test queue with the A2A SDK event bus.
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";

type EventQueue = {
  enqueueEvent(event: unknown): void;
};

type EventSink = ExecutionEventBus | EventQueue;

export class DBSpecialistExecutor {
  async execute(
    requestContext: Partial<RequestContext> & { userMessage?: { text?: string } },
    eventSink: EventSink,
  ): Promise<void> {
    this.publishWorking(requestContext, eventSink);
    this.publishCompleted(requestContext, eventSink);
  }

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.finished();
  }

  private publishWorking(
    requestContext: Partial<RequestContext>,
    eventSink: EventSink,
  ): void {
    if ("enqueueEvent" in eventSink) {
      eventSink.enqueueEvent({ type: "working", message: "analysis started" });
      return;
    }

    eventSink.publish({
      kind: "status-update",
      taskId: requestContext.taskId ?? "gate-a-task",
      contextId: requestContext.contextId ?? "gate-a-context",
      status: { state: "working", timestamp: new Date().toISOString() },
      final: false,
    });
  }

  private publishCompleted(
    requestContext: Partial<RequestContext>,
    eventSink: EventSink,
  ): void {
    if ("enqueueEvent" in eventSink) {
      eventSink.enqueueEvent({ type: "completed", result: { findings: [] } });
      return;
    }

    eventSink.publish({
      kind: "status-update",
      taskId: requestContext.taskId ?? "gate-a-task",
      contextId: requestContext.contextId ?? "gate-a-context",
      status: { state: "completed", timestamp: new Date().toISOString() },
      final: true,
    });
    eventSink.finished();
  }
}
