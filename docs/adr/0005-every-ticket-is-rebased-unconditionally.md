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
- When the rebase cannot land: `git rebase --abort`, ticket failed, dependents skipped transitively,
  and **the spec branch is untouched** — no revert, no gate re-run. The branch, the worktree and the
  transcript are kept, which is what makes the ticket recoverable on a later resume.

## Who may abort

The resolving skill never aborts. Two things may, and they are the two that cannot be confused with
each other:

- **The script, during a run.** It aborts what the resolver left in its way — on a non-zero exit, on
  a tree still conflicted after the agent exits, and on a rebase that ended without landing. The
  third is the one worth naming: a resolver that aborted leaves a tree that is clean, unconflicted
  and exactly where it started, which is indistinguishable from a rebase that never conflicted
  unless the branch is asked whether it now contains the tip it was rebased onto. So it is asked.
- **The prepare agent, before one.** A killed run leaves a rebase nobody is holding, and the worktree
  stays stuck until something abandons it. This ADR grants that abort to the prepare agent — the
  agent ADR-0012 makes responsible for a ticket stuck at `rebase:failed`, and the only thing that
  looks at a wrecked worktree before the normal track picks it up. It is a different act from the
  script's: the script's abort ends an attempt that failed, the prepare agent's clears wreckage so
  that a fresh attempt can be made.

Abort is the only rebase state change that is not a failure in itself, which is why asking for one
where there is no rebase is not an error either: every failure path can ask.
