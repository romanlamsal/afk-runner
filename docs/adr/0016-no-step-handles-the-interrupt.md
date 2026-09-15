---
status: accepted
---

# No step handles the interrupt; draining is an optimisation

An interrupt can arrive at any point: mid-implementer, mid-rebase, between a squash merge and the
gate. The obvious design has each step trap the signal and unwind to a clean state.

Because a lifecycle event is appended when a step *starts* (ADR-0011), a hard kill at any point
leaves a state a resumed run can dispatch on. **A kill is already safe.** Draining therefore buys
nothing in correctness — it exists only so that an implementer six minutes into its work is not
thrown away.

**Decision: no step handles the interrupt.** The first interrupt sets a flag: start nothing new.
In-flight implementers and the merge track's current ticket run to completion, and the run then
exits. A second interrupt kills outright, and the next `--resume` cleans up.

The flag is the decision function's `draining` parameter, so draining is a scheduling rule like any
other rather than a shutdown path: the loop reads one flag per pass and nothing else changes.

**Every child gets a process group of its own.** A terminal sends its interrupt to the whole
foreground group, so a child sharing afk's group would be killed by the *first* interrupt — the one
that exists to spare it. Detaching each child is therefore what makes draining mean anything, and it
is why the second interrupt kills those groups on the way out rather than leaving agents writing
into worktrees the next start is about to read.

**A drained run finishes like the partial run it is**: it pushes the spec branch and opens a draft
pull request naming what did not land. What was interrupted is the next start's work either way, and
a drain that threw away the tickets it had already verified would make stopping a run expensive —
which is the thing this record exists to prevent.

## Considered options

- **Every step traps the signal and unwinds.** Rejected. It adds a failure mode per step — an
  unwind that is itself interrupted — to buy a property the event log already provides.
- **No drain; the first interrupt kills.** Rejected. It throws away the most expensive work the
  runner does, for no gain, since a clean kill is safe either way.
- **A drained run opens nothing.** Rejected. It gives the interrupt an exit path of its own, and
  loses the review of work the gate already proved.

## Consequences

- Draining is a courtesy, not a guarantee. Nothing downstream may assume a run exited cleanly.
- This is only true for as long as events are written at step start. A step that writes its event
  only on completion silently makes the second interrupt unsafe.
- The exit code of a drained run is the partial run's `1`, or `0` where the drain happened to land
  everything. Only the second interrupt exits `130`.
- A second interrupt kills afk's children rather than waiting for them, so a step it interrupts
  leaves its `running` event behind — which is exactly what the next start dispatches on.
