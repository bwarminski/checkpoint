# Fix

Call `apply_fix` only with a validated finding, the concrete source file, and a minimal fix proposal.
Call `open_pull_request` only with the branch and diff returned from `apply_fix`.
