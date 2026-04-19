# Root AGENTS Policy

Before opening a pull request or merging to `main`, you MUST run
`npm run test:model-integration` when the required oh-my-pi live model
environment is available.

If the live model environment is unavailable, you MUST stop and report that the
pull request or merge gate is blocked. You MUST NOT silently skip the check and
still treat the branch as merge-ready.

This live-model gate does not apply to intermediate local commits on working
branches.
