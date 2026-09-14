---
status: accepted
---

# One writer owns the spec branch

The spec branch is the only branch a run writes to, and several steps want to touch it: the merge,
the gate, and a revert when the gate goes red.

**Decision: one long-lived worktree holds the spec branch checked out and is its sole writer, and
the merge track is serial — one ticket at a time.**

## Consequences

- **Serial is a correctness precondition, not a performance choice.** Because one worktree owns the
  branch and nothing can land between a ticket's rebase and its merge, that merge cannot conflict.
  Parallelising the merge track would silently reintroduce conflicts at a step that no longer
  handles them.
- Git refuses to check one branch out in two worktrees, which makes a second writer *unrepresentable*
  rather than something the script has to guard against.
- Merge-track throughput — one serial track behind a pool of parallel implementers — is untested.
  It is the known pressure point of this design.
