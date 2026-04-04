// ABOUTME: Defines the GitHub integration point for opening DB-fix pull requests.
// ABOUTME: Leaves PR automation intentionally minimal until later executor work lands.
type PullRequestInput = {
  finding?: {
    fingerprint?: string;
  };
};

type PullRequestResult = {
  url: string;
};

type GitHubClient = {
  openPullRequest(input: PullRequestInput): Promise<PullRequestResult>;
};

export class GitHubTool {
  constructor(private readonly client?: GitHubClient) {}

  async openPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
    if (this.client) {
      return this.client.openPullRequest(input);
    }

    const fingerprint = input.finding?.fingerprint ?? "unknown";

    return {
      url: `local://db-specialist/pull-requests/${fingerprint}`,
    };
  }
}
