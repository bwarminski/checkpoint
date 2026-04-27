# Eng review: OMP container isolation

Reviewing `docs/superpowers/plans/2026-04-26-omp-container-isolation.md` as
implemented on `wip/omp-container-isolation`.

**Verification baseline:** `npm test` 77 pass / 5 skipped / 0 fail.
`npm run typecheck` clean. Plan Task 7 verification gates pass.

## Plan fidelity

All seven tasks completed; all named files exist; tests pass. Two material
divergences from the plan, both intentional:

1. Container user changed `vscode` → `codespace`. Plan was wrong:
   `mcr.microsoft.com/devcontainers/universal:2-linux` ships with `codespace`
   as the unprivileged user. Implementor caught it during build. Plan should
   be updated to match.
2. `--env KEY=value` flipped to `--env KEY` (host-env passthrough). Not in
   plan. Done so dry-run output and `docker inspect` don't leak secret values.
   Correct call. Side effect: host shell must export the env, which
   `export_default_db_env` handles.

## Findings

### [P2] (confidence 9/10) Skilled workspace lock-in is asymmetric and undocumented
`scripts/omp-lab-common.sh:130` — `validate_lab_owned_workspace_path` requires
the skilled `OMP_LAB_WORKSPACE` to live strictly under `~/.oh-my-pi-lab/`.
Control mode only forbids repo-visible paths. Neither plan nor design called
for this restriction. Recommendation: weaken to "must not be under repo root"
(mirror control), or document why skilled is stricter. The README says nothing
about this constraint.

### [P3] (confidence 9/10) Duplicated SSH-key existence check
`omp-lab-common.sh:229,248` — `require_git_ssh_key_if_enabled` and
`append_git_ssh_args` independently check the same key with the same error
message. The early gate exists only so the "SSH missing-key failure does not
invoke docker outside dry run" test passes. Either remove the early gate (args
are assembled before any docker invocation; only `run_or_print_docker_args`
execs) or remove the duplicate check inside `append_git_ssh_args`. Pick one.

### [P3] (confidence 8/10) `OMP_LAB_ENABLE_SSH` forwarded into the container has no consumer
`omp-lab-common.sh:244` — `--env OMP_LAB_ENABLE_SSH=1` is passed in but
nothing in the image reads it. SSH wiring is purely the bind mount plus the
Dockerfile-baked `~/.ssh/config`. Drop the forward.

### [P3] (confidence 8/10) Cleanup duplicates dry-run plumbing
`clean-omp-lab.sh:28-36` reimplements the dry-run printer
(`run_cleanup_command`); `:54-56` hardcodes the docker pipeline as plain
printf strings because xargs pipelines can't be expressed as argv. Acceptable,
but it means there are now three "print or exec" variants. If more shell
pipelines appear, factor into a shared helper.

### [P3] (confidence 7/10) Implementation discipline — 12 `fix:` commits after the feature commits
Every task was followed by 1-3 follow-up `fix:` commits (key-leak,
db-env-leak, GitHub token leak, docker missing, root workspace, ancestor
workspace, etc.). All landed as real defensive hardening, but the plan's TDD
steps did not capture these concerns up-front. Process note for next plan: a
"negative tests" pass (what should NOT leak / should NOT run) belongs in the
plan rather than as post-hoc fixes.

## Coverage map

```
CODE PATHS                                            STATUS
[+] Dockerfile contract                                ★★★ regex assertions + gated smoke
[+] omp-lab-common.sh
  ├── resolve_gemini_api_key                          ★★★ env + file fallback + leak checks
  ├── require_omp_model                               ★★  via run-model-integration test
  ├── validate_control_workspace_path                 ★★★ repo / repo-child / ancestor / root / empty
  ├── validate_lab_owned_workspace_path               ★★  asserted, but UX gap (above)
  ├── validate_lab_workspace_removal_path             ★★★ unsafe paths refused
  ├── append_base_docker_args                         ★★★ env passthrough + no value leakage
  ├── append_git_ssh_args                             ★★★ enabled + missing-key + no docker invoke
  ├── require_docker_for_container_run                ★★  missing-docker test
  └── run_or_print_docker_args                        ★★★ shell-escape + dry-run
[+] run-omp-control-container.sh                      ★★★ happy + SSH + reset + source-visibility
[+] run-omp-skilled-container.sh                      ★★  happy + stale-state replace + outside-workspace refuse
                                                          [GAP] no test confirming /skills, /src
                                                                mounts respect readonly inside the
                                                                container
[+] clean-omp-lab.sh                                  ★★★ workspaces + labels + image flag + missing daemon
```

28 tests + 1 gated smoke. No code paths in the lab scripts lack a test.

## Optional gap

The skilled runner mounts `${REPO_ROOT}/skills` and `${REPO_ROOT}/src`
read-only. Dry-run test asserts the `--mount` string contains `,readonly`.
No test exercises the actual built image to confirm the bind respects it
(e.g., `touch /workspace/.omp/skills/x` should fail). That belongs in the
gated `OMP_LAB_DOCKER_SMOKE=1` smoke test. Cheap to add; not required for
ship.

## Verdict

Implementation is **complete and shippable**. Plan was honored; divergences
are corrections to the plan rather than scope drift. The defensive validators
added beyond the plan are worth keeping with one carve-out: relax or document
the `validate_lab_owned_workspace_path` restriction on the skilled runner.
