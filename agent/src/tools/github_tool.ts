// ABOUTME: Defines the GitHub integration point for opening DB-fix pull requests.
// ABOUTME: Leaves PR automation intentionally minimal until later executor work lands.
type PullRequestInput = {
  finding?: {
    fingerprint?: string;
    source_tag?: string;
  };
  fix?: {
    fix_type?: string;
    summary?: string;
  };
  headRef?: string;
  codeDiff?: string;
  validation?: {
    plan_rows?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
};

type PullRequestResult = {
  url: string;
};

type GitHubEnv = {
  DEMO_BASE_REF?: string;
  DEMO_HEAD_REF?: string;
  DEMO_REPO?: string;
  GITHUB_TOKEN?: string;
};

type GitHubToolOptions = {
  env?: GitHubEnv;
  fetchImpl?: typeof fetch;
};

type GitHubClient = {
  openPullRequest(input: PullRequestInput): Promise<PullRequestResult>;
};

export class GitHubTool {
  private readonly env: GitHubEnv;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly client?: GitHubClient,
    options: GitHubToolOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async openPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
    if (this.client) {
      return this.client.openPullRequest(input);
    }

    const fingerprint = input.finding?.fingerprint ?? "unknown";
    const token = this.env.GITHUB_TOKEN;

    if (!token) {
      return {
        url: `local://db-specialist/pull-requests/${fingerprint}`,
      };
    }

    const repo = this.env.DEMO_REPO;
    if (!repo) {
      throw new Error("GitHubTool requires DEMO_REPO when GITHUB_TOKEN is set.");
    }

    const head = input.headRef ?? this.env.DEMO_HEAD_REF;
    if (!head) {
      throw new Error("GitHubTool requires DEMO_HEAD_REF when GITHUB_TOKEN is set.");
    }

    const base = this.env.DEMO_BASE_REF ?? "main";
    const response = await this.fetchImpl(`https://api.github.com/repos/${repo}/pulls`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "checkpoint-db-specialist-agent",
      },
      body: JSON.stringify({
        base,
        body: buildPullRequestBody(input),
        head,
        title: buildPullRequestTitle(input),
      }),
    });

    if (!response.ok) {
      const existingUrl = await resolveExistingPullRequestUrl(
        this.fetchImpl,
        this.env,
        head,
        response,
      );
      if (existingUrl) {
        return { url: existingUrl };
      }

      throw new Error(`GitHub pull request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as { html_url?: string };
    if (typeof payload.html_url !== "string" || payload.html_url.length === 0) {
      throw new Error("GitHub pull request response did not include html_url.");
    }

    return {
      url: payload.html_url,
    };
  }
}

async function resolveExistingPullRequestUrl(
  fetchImpl: typeof fetch,
  env: GitHubEnv,
  headRef: string,
  response: Response,
): Promise<string | null> {
  if (response.status !== 422) {
    return null;
  }

  const payload = await response.json().catch(() => null) as {
    errors?: Array<{ message?: string }>;
  } | null;
  const errors = payload?.errors ?? [];
  const hasExistingPrError = errors.some((error) =>
    typeof error.message === "string" && /pull request already exists/i.test(error.message),
  );
  if (!hasExistingPrError || !env.DEMO_REPO || !headRef) {
    return null;
  }

  const owner = env.DEMO_REPO.split("/", 1)[0];
  const base = env.DEMO_BASE_REF ?? "main";
  const query = new URLSearchParams({
    state: "open",
    head: `${owner}:${headRef}`,
    base,
  });
  const existingResponse = await fetchImpl(
    `https://api.github.com/repos/${env.DEMO_REPO}/pulls?${query.toString()}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_TOKEN ?? ""}`,
        "user-agent": "checkpoint-db-specialist-agent",
      },
    },
  );
  if (!existingResponse.ok) {
    return null;
  }

  const pulls = await existingResponse.json() as Array<{ html_url?: string }>;
  return typeof pulls[0]?.html_url === "string" ? pulls[0].html_url : null;
}

function buildPullRequestTitle(input: PullRequestInput): string {
  const fingerprint = input.finding?.fingerprint ?? "unknown";
  const fixType = input.fix?.fix_type ?? "db_fix";

  return `[db-specialist] ${fixType} for ${fingerprint}`;
}

function buildPullRequestBody(input: PullRequestInput): string {
  const explainRows = input.validation?.plan_rows
    ?.map((row) => Object.values(row).join(" "))
    .join("\n") ?? "No EXPLAIN rows captured.";

  return [
    "## DB Specialist Finding",
    `- fingerprint: ${input.finding?.fingerprint ?? "unknown"}`,
    `- source_tag: ${input.finding?.source_tag ?? "unknown"}`,
    `- fix_type: ${input.fix?.fix_type ?? "unknown"}`,
    `- summary: ${input.fix?.summary ?? "unknown"}`,
    "",
    "## Code Change",
    "```diff",
    input.codeDiff ?? "No code diff captured.",
    "```",
    "",
    "## EXPLAIN (sample query)",
    "```",
    explainRows,
    "```",
  ].join("\n");
}
