---
status: accepted
---

# The gate-red sequence lives in the decision function

ADR-0009 fixes what happens when the gate goes red: one fix attempt, then a revert, then the gate
again on the reverted tip. That sequence was written as control flow inside the merge track, so the
only way to assert it was through fakes, and the only way to be part-way through it was to be
part-way through a function call. A run killed during the fix attempt therefore had no route back
into the sequence at all: its ticket read as beyond repair, and its merge sat on a spec branch the
run kept merging onto — the state ADR-0009's prove-the-tip step exists to prevent.

**Decision: `fix`, `gate` and `revert` become actions the decision function emits.** (These three
turned out to be an instance of a general rule rather than a set of their own — ADR-0026.) It reads the
log and gives the next one; the services perform one step each and append their events. Nothing
outside the function knows what follows a red gate.

**`fix` is a step (ADR-0022) but not a broken step.** A killed fix gets no prepare pass. It goes
straight back to the merge track and the gate runs again, because the branch is what afk proves and
not what the agent said (ADR-0009) — and its start event has already spent the budget, so the
sequence carries on to the revert exactly where a live run would have.

The cases, in full. A ticket's status is its last lifecycle event:

| status | condition | action |
| --- | --- | --- |
| `gate: failed` | no `fix` start event | `fix` |
| `fix: ok` or `fix: failed` | — | `gate` |
| `gate: failed` | a `fix` start event exists | `revert` |
| `fix: running`, stale | — | `gate` |
| `gate: running`, stale | — | `gate` |
| `revert: running`, stale | — | none: the ticket is doomed (ADR-0012) |

## Considered options

- **Keep the sequence in the service and give it a budget read.** Rejected. It closes the same
  window, but it puts "the budget is spent, so revert" inside a service — a rule outside the one
  function that is meant to hold every rule (ADR-0019), and a rule that has to survive a process
  boundary, which is the class of rule that has gone wrong here before.
- **Let the prepare agent choose between a fix and a revert.** Rejected, and it was the original
  intention behind a recovery step. Two things sank it: the prepare agent would then write to the
  spec branch, which one worktree owns (ADR-0006); and at this node there is nothing to judge,
  because one gate run answers definitively what an agent could only guess. The forward and backward
  moves the prepare agent *does* make are local to the ticket — that is the abort (ADR-0005), and it
  is unchanged.

## Consequences

- **The sequence is asserted with no fakes and no git**: a manifest, a list of events, a list of
  actions (ADR-0019).
- A killed fix has no flow of its own. It takes the ordinary one, and cannot buy a second fix.
- The merge track stays serial: `fix`, `gate` and `revert` are all actions about the spec branch, so
  the function never emits a second one while one is in flight (ADR-0006, ADR-0019).
- `fix.ts` and the merge track shrink to one step each. What they lose is the sequence, not the
  work.
