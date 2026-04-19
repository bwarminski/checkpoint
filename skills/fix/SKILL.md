---
name: fix
description: Use validated findings to make the smallest safe code fix and prepare a reviewable branch.
---

# Fix

Call `apply_fix` only with a validated finding, the concrete source file, and a minimal fix proposal.
Call `open_pull_request` only with the branch and diff returned from `apply_fix`.
