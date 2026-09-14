---
status: accepted
---

# Every ticket is rebased unconditionally

Reconciling a ticket onto the spec branch admits two paths: a cheap one when the ticket's commits
apply cleanly, and an expensive one — a conflict resolver — when they do not. Choosing between them
requires probing whether a conflict would occur.

**Decision: every ticket is rebased onto the spec branch's tip, always.** No probe, no fast path.

## Considered options

- **Probe first, skip the rebase when it would be a no-op.** Rejected. One path that always runs is
  one path that is always exercised; a rare path is where bugs sit unnoticed until the run that
  needs it. The probe has no remaining use once nothing branches on its result.

## Consequences

- The rebase runs in the **ticket's own worktree**. That worktree already holds the branch, and git
  refuses to check one branch out in two worktrees — so a resolver with a worktree of its own is a
  path that can never work. It is also the warm, installed worktree, so the resolver can run this
  repository's own checks on what it produced instead of resolving blind.
- The tree must be clean before the rebase starts. Rebasing over uncommitted work buries it.
- The resolving skill never aborts; the script does — on a non-zero exit, or on a tree still
  conflicted after the agent exits.
- When the rebase cannot land: `git rebase --abort`, ticket failed, dependents skipped transitively,
  and **the spec branch is untouched** — no revert, no gate re-run. The branch, the worktree and the
  transcript are kept, which is what makes the ticket recoverable on a later resume.
