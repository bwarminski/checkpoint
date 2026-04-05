// ABOUTME: Verifies GitHubTool can return a stable demo pull request result locally.
// ABOUTME: Keeps the Step 8 runtime flow from depending on a live external GitHub repo.
import assert from "node:assert/strict";
import test from "node:test";

import { GitHubTool } from "../src/tools/github_tool.ts";

test("GitHubTool returns a local demo pull request url when no client is configured", async () => {
  const tool = new GitHubTool(undefined, {
    env: {},
  });

  const result = await tool.openPullRequest({
    finding: { fingerprint: "fp-demo" },
  });

  assert.deepEqual(result, {
    url: "local://db-specialist/pull-requests/fp-demo",
  });
});

test("GitHubTool posts a real pull request when token and repo config are present", async () => {
  const requests: Array<{ body: string; headers: Headers; url: string }> = [];
  const tool = new GitHubTool(undefined, {
    env: {
      DEMO_BASE_REF: "main",
      DEMO_HEAD_REF: "agent/demo-fix",
      DEMO_REPO: "brett/db-specialist-demo",
      GITHUB_TOKEN: "secret-token",
    },
    fetchImpl: async (url, init) => {
      requests.push({
        body: String(init?.body ?? ""),
        headers: new Headers(init?.headers),
        url: String(url),
      });

      return new Response(
        JSON.stringify({ html_url: "https://github.com/brett/db-specialist-demo/pull/12" }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await tool.openPullRequest({
    finding: {
      fingerprint: "fp-real",
      source_tag: "todos#index",
    },
    fix: {
      fix_type: "rewrite_like",
      summary: "Replace the leading-wildcard title search with a searchable alternative.",
    },
    validation: {
      plan_rows: [{ "QUERY PLAN": "Seq Scan on todos" }],
      validated: true,
    },
  } as any);

  assert.equal(result.url, "https://github.com/brett/db-specialist-demo/pull/12");
  assert.equal(requests[0]?.url, "https://api.github.com/repos/brett/db-specialist-demo/pulls");
  assert.match(requests[0]?.headers.get("authorization") ?? "", /^Bearer secret-token$/);
  assert.match(requests[0]?.body ?? "", /fp-real/);
  assert.match(requests[0]?.body ?? "", /todos#index/);
  assert.match(requests[0]?.body ?? "", /rewrite_like/);
  assert.match(requests[0]?.body ?? "", /Seq Scan on todos/);
});

test("GitHubTool returns an existing pull request url when GitHub reports one already exists", async () => {
  const tool = new GitHubTool(undefined, {
    env: {
      DEMO_BASE_REF: "main",
      DEMO_HEAD_REF: "agent/demo-fix",
      DEMO_REPO: "brett/db-specialist-demo",
      GITHUB_TOKEN: "secret-token",
    },
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/pulls") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            errors: [{ message: "A pull request already exists for brett:agent/demo-fix." }],
            message: "Validation Failed",
          }),
          {
            status: 422,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify([{ html_url: "https://github.com/brett/db-specialist-demo/pull/15" }]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await tool.openPullRequest({
    finding: { fingerprint: "fp-existing", source_tag: "todos#status" },
    fix: { fix_type: "add_index", summary: "Add an index for status." },
    validation: { validated: true },
  } as any);

  assert.equal(result.url, "https://github.com/brett/db-specialist-demo/pull/15");
});
