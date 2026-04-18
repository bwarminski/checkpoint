# Live Checker Integration Test Design

## Goal

Add an honest `OMP_MODEL`-gated integration test that exercises the live SQL checker execution path introduced in the Bun SDK helper. The test must cover the real `createLiveQueryChecker()` path, including model lookup, API key resolution, the `completeSimple()` call, and JSON result parsing.

## Scope

Keep the existing live session test that verifies the generated workspace can expose the coarse SQL tool surface through the SDK. Add a second live integration test that directly invokes the real checker tools through the same SDK-backed tool definitions.

This change does not add new runtime features, does not change the SQL tool contracts, and does not introduce mocks into the live integration path.

## Approach

The new test should use the generated temporary workspace and real tool definitions, with `cwd` set to that workspace just like the existing SDK integration flow. Instead of relying on the model to decide whether to invoke a checker tool, the test should directly call the checker tool definitions for:

- `sql_db_checker`
- `clickhouse_db_checker`

Each call should use a minimal exploratory query like `select 1`, and the assertions should stay intentionally loose:

- the tool result is JSON text
- the parsed payload contains a valid `verdict`
- `rewrittenQuery` is a string
- `notes` is an array

This keeps the test focused on the risky runtime path rather than model-specific verdict wording.

## Boundaries

The test remains gated on `OMP_MODEL` and Bun availability. When those prerequisites are absent, it must skip honestly.

The test should not depend on a full agent conversation, prompt heuristics, or the assistant choosing a tool on its own. It is a direct integration check of the live checker tool execution path.

## Verification

The change is complete when all of the following are true:

- the new live checker test fails before implementation because no helper exists to invoke the real checker tools directly
- the new helper and test are added with the smallest reasonable change
- `npm test -- test/integration/oh_my_pi_session.test.ts` passes
- `npm run typecheck` passes
- `npm run test:model-integration` passes with `OMP_MODEL` set, and skips honestly when it is unset
