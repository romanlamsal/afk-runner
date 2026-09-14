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

## Considered options

- **Every step traps the signal and unwinds.** Rejected. It adds a failure mode per step — an
  unwind that is itself interrupted — to buy a property the event log already provides.
- **No drain; the first interrupt kills.** Rejected. It throws away the most expensive work the
  runner does, for no gain, since a clean kill is safe either way.

## Consequences

- Draining is a courtesy, not a guarantee. Nothing downstream may assume a run exited cleanly.
- This is only true for as long as events are written at step start. A step that writes its event
  only on completion silently makes the second interrupt unsafe.
