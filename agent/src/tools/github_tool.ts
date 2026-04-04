// ABOUTME: Defines the GitHub integration point for opening DB-fix pull requests.
// ABOUTME: Leaves PR automation intentionally minimal until later executor work lands.
type GitHubClient = {
  openPullRequest(input: unknown): Promise<unknown>;
};

export class GitHubTool {
  constructor(private readonly client?: GitHubClient) {}

  async openPullRequest(input: unknown): Promise<unknown> {
    if (!this.client) {
      throw new Error("GitHubTool is pending implementation.");
    }

    return this.client.openPullRequest(input);
  }
}
