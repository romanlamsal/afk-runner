---
status: accepted
---

# An outcome names what the tool distinguished

ADR-0011 closed `outcome` at `running | ok | failed | skipped`, and rejected a closed enum of failure
reasons on the grounds that guessing the set before hitting it is how folklore starts. That argument
is right about reasons and too broad about outcomes.

A rebase git stopped part-way is not a reason afk ascribed to a failure. Git returns it, the git port
has typed it since the rewrite — `RebaseResult` is `landed | conflicted | failed` — and afk asks
`conflicted()` about it directly. The distinction existed everywhere except in the log, where it
collapsed into `failed`.

That collapse cost the machine a node. `resolve` is taken only out of a conflict, so with the
conflict unrecorded no decision function could give a `resolve` action, and the rebase, the resolve
and the squash stayed welded into one merge action — decided from inside, where git was visible.

**Decision: `outcome` grows by `conflicted`.** A member may be added when it passes this test:

> An outcome names **what the tool distinguished**. It never names **what afk ascribed**.

`conflicted` passes: git draws it, and afk reads it. "The network flaked", "the laptop slept", "the
agent timed out" fail it — afk would be drawing those, and they are not usefully the same shape,
which is ADR-0011's argument kept rather than overturned.

Only a rebase produces `conflicted`. A squash cannot conflict, because the ticket was rebased onto
that tip and the merge track is serial (ADR-0006); a revert that conflicts halts the run rather than
becoming a state (ADR-0009).

## Considered options

- **Send the conflict resolver to every failed rebase, and do not distinguish.** Rejected. It has
  the shape of ADR-0012's refusal to classify implementer failures, but the cost is not the same:
  the resolver is instructed to resolve a conflict and told never to abort, so a rebase that failed
  for any other reason hands it a worktree with nothing to resolve and no way out of it.
- **Carry the conflict in `detail`.** Rejected. `detail` is free text nothing branches on (ADR-0011),
  and branching on it here would make that rule one afk keeps except where it is inconvenient.
- **A boolean field beside `outcome`.** Rejected: an enum member with extra steps, and one every
  reader has to combine with the outcome to know where a ticket is.

## Consequences

- The rebase node is observable from the log, so `resolve` can be given as an action (ADR-0026).
- ADR-0011's rejection of a failure-reason enum stands, and now has a stated boundary.
- `outcome` is still closed, and still grows only by a deliberate act.
- **One node stays unobservable from the log alone, and no enum can fix it.** Between a squash
  returning and its event being appended there are two durable stores and no transaction. Its
  witness is git, and the `afk-ticket` trailer is the field that holds it (ADR-0011).
