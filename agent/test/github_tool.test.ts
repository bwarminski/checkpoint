// ABOUTME: Verifies GitHubTool can return a stable demo pull request result locally.
// ABOUTME: Keeps the Step 8 runtime flow from depending on a live external GitHub repo.
import assert from "node:assert/strict";
import test from "node:test";

import { GitHubTool } from "../../src/tools/github_tool.ts";

test("GitHubTool returns a local demo pull request url when no client is configured", async () => {
  const tool = new GitHubTool(undefined, {
    env: {},
  });

  const result = await tool.openPullRequest({
    finding: { queryid: "101" },
  });

  assert.deepEqual(result, {
    url: "local://db-specialist/pull-requests/101",
  });
});

test("GitHubTool posts a real pull request when token and repo config are present", async () => {
  const requests: Array<{ body: string; headers: Headers; url: string }> = [];
  const tool = new GitHubTool(undefined, {
    env: {
      DEMO_BASE_REF: "main",
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
      queryid: "202",
      source_file: "app/controllers/todos_controller.rb:12",
    },
    fix: {
      fix_type: "rewrite_like",
      summary: "Replace the leading-wildcard title search with a searchable alternative.",
    },
    validation: {
      plan_rows: [{ "QUERY PLAN": "Seq Scan on todos" }],
      validated: true,
    },
    headRef: "agent/demo-fix/fp-real",
    codeDiff: "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb",
  } as any);

  assert.equal(result.url, "https://github.com/brett/db-specialist-demo/pull/12");
  assert.equal(requests[0]?.url, "https://api.github.com/repos/brett/db-specialist-demo/pulls");
  assert.match(requests[0]?.headers.get("authorization") ?? "", /^Bearer secret-token$/);
  assert.match(requests[0]?.body ?? "", /202/);
  assert.match(requests[0]?.body ?? "", /app\/controllers\/todos_controller\.rb:12/);
  assert.doesNotMatch(requests[0]?.body ?? "", /source_tag/);
  assert.match(requests[0]?.body ?? "", /rewrite_like/);
  assert.match(requests[0]?.body ?? "", /## Code Change/);
  assert.match(requests[0]?.body ?? "", /```diff/);
  assert.match(requests[0]?.body ?? "", /diff --git a\/app\/controllers\/todos_controller\.rb b\/app\/controllers\/todos_controller\.rb/);
  assert.match(requests[0]?.body ?? "", /## EXPLAIN \(sample query\)/);
  assert.match(requests[0]?.body ?? "", /Seq Scan on todos/);
});

test("GitHubTool throws when token is set without DEMO_REPO", async () => {
  const tool = new GitHubTool(undefined, {
    env: {
      GITHUB_TOKEN: "secret-token",
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ html_url: "https://example.test/pr/ignored" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    tool.openPullRequest({
      finding: { queryid: "303" },
      fix: { fix_type: "add_index", summary: "Add an index." },
      validation: { validated: true },
    } as any),
    /DEMO_REPO/,
  );
});

test("GitHubTool requires a headRef when token and repo config are present", async () => {
  const tool = new GitHubTool(undefined, {
    env: {
      DEMO_BASE_REF: "main",
      DEMO_REPO: "brett/db-specialist-demo",
      GITHUB_TOKEN: "secret-token",
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ html_url: "https://example.test/pr/ignored" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    tool.openPullRequest({
      finding: { queryid: "404" },
      fix: { fix_type: "add_index", summary: "Add an index." },
      validation: { validated: true },
    } as any),
    /headRef/,
  );
});

test("GitHubTool returns an existing pull request url when GitHub reports one already exists", async () => {
  const tool = new GitHubTool(undefined, {
    env: {
      DEMO_BASE_REF: "main",
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
    finding: { queryid: "505", source_file: "app/models/todo.rb:5" },
    fix: { fix_type: "add_index", summary: "Add an index for status." },
    validation: { validated: true },
    headRef: "agent/demo-fix/fp-existing",
  } as any);

  assert.equal(result.url, "https://github.com/brett/db-specialist-demo/pull/15");
});
