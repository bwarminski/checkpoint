# Live Checker Integration Test Plan

## Task 1: Add a failing live-checker integration test

Extend `test/integration/oh_my_pi_session.test.ts` with an `OMP_MODEL`-gated test that expects to directly exercise both live checker tools through the generated workspace flow. Run the focused test command first to confirm the new case fails for the expected reason.

## Task 2: Add a direct checker invocation helper

Make the smallest change in `test/helpers/oh_my_pi_workspace.ts` to expose the real SQL tool definitions or a narrow helper that invokes:

- `sql_db_checker`
- `clickhouse_db_checker`

The helper must use the real Bun SDK-backed runtime path and the real `createLiveQueryChecker()` implementation. Do not mock the model, checker, or tool definitions.

## Task 3: Verify the live checker contract

Update the new integration test to parse the returned text and assert only the stable parts of the contract:

- `verdict` is one of `safe`, `rewrite`, `reject`
- `rewrittenQuery` is a string
- `notes` is an array

Keep the assertions narrow enough to tolerate ordinary model variance.

## Task 4: Run full verification for the slice

Run:

- `npm test -- test/integration/oh_my_pi_session.test.ts`
- `npm run typecheck`
- `npm run test:model-integration`

Only after those commands pass should the change be reported complete.
