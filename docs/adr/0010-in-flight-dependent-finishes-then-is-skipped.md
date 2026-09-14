---
status: accepted
---

# A dependent already in flight when its blocker is reverted finishes, then is skipped

Layers made this impossible: nothing started until the layer below had verified. Slate scheduling
(ADR-0001) makes it routine — a ticket can be halfway through implementation when the blocker it
depends on is reverted out of the spec branch.

**Decision: let it finish, then skip it** — checked as the merge track's first act on that ticket,
before the rebase. Its branch, worktree and transcript are kept.

## Considered options

- **Kill the in-flight implementer as soon as its blocker is reverted.** Rejected. The expensive
  half is already paid, and a killed session is harder to read afterwards than a finished one.

## Consequences

- Implementer time is wasted, knowingly. This is throughput bought at the price of wasted work —
  decided, not discovered. It is the value the layer barrier used to provide, traded away.
- **Merging is the one thing that must not happen**: the work built on a tree that no longer exists
  upstream.
- The skip is checked **before** the rebase, so no resolver call is spent on work about to be
  discarded.
