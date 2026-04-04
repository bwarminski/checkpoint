// ABOUTME: Reserves the source lookup tool boundary without choosing a transport yet.
// ABOUTME: Keeps Gate A clear until the code search client contract is approved.
type CodeSearchTransport = {
  locate(input: unknown): Promise<unknown>;
};

export class CodeSearchTool {
  constructor(private readonly transport?: CodeSearchTransport) {}

  async locate(input: unknown): Promise<unknown> {
    if (!this.transport) {
      throw new Error(
        "CodeSearchTool is pending Gate A until the code search transport is approved.",
      );
    }

    return this.transport.locate(input);
  }
}
