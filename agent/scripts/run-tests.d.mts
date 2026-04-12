// ABOUTME: Declares the public test-wrapper helpers exported from run-tests.mjs.
// ABOUTME: Keeps the agent typecheck strict while the runtime entrypoint stays in .mjs.
export function buildTestCommand(args: Array<string>): Array<string>;
export function getDefaultTestFiles(): Array<string>;
