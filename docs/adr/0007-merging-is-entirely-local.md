---
status: accepted
---

# Merging is entirely local; no ticket PRs; trunk gets one squash per spec

Per-ticket granularity is wanted *during* the run, on the spec branch, where an operator reads what
happened. The repository's default branch receives one squash commit per spec, and its granularity
is explicitly not cared about.

**Decision: tickets merge locally** — `git merge --squash` into the spec branch, in the gate
worktree. There is no pull request per ticket. One spec PR is opened at the end and squash-merged.

## Considered options

- **Keep a pull request per ticket for reviewability.** Rejected. Nothing reviews them, and they
  carry real machinery: a create call, a `mergeable` poll, and an eventual-consistency retry loop
  whose own stated justification was that *every merge error observed so far was a race*. Races are
  a property of merging through a remote API. A local merge on a single-writer branch (ADR-0006) has
  none, so the loop is deleted rather than kept.

## Consequences

- The squash body is the implementer's own commit messages, plus the resolver's note where there was
  a conflict, plus the trailer `afk-ticket: <spec>/<n>`.
- **There is no conflict trailer.** A trailer is for a machine, and the only machine that would read
  one is this runner, which already has the event log (ADR-0011). The resolution's *prose* stays: a
  spec-PR reviewer has no other way to learn that an agent made an unreviewed judgement call inside
  that commit, which is this design's live risk.
- The spec PR's title and summary are written by an agent; the `Closes #<n>` lines are appended by
  the script, one per *verified* ticket, composed from state.
