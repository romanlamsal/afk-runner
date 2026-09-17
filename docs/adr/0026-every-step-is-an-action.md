---
status: accepted
---

# Every step is an action

A ticket's life is a state machine: the statuses are its states, the steps are the moves between
them. afk named those moves twice, at two grains. `STEPS` named nine; `Action` named five; and
`merge` welded rebase, resolve and squash into one. ADR-0023 moved three more into `Action` for the
gate-red sequence, which left the set correct but arbitrary — no reader could say why `gate` was an
action and `rebase` was not.

**Decision: the action set is the step set.** `Action` is
`setup | implement | prepare | rebase | resolve | merge | gate | fix | revert`, plus `skip` and
`finish`, which are about the run rather than about one ticket's machine. `merge` is the squash and
its trailer check, and nothing else.

What stood in the way was observability, and it was one node wide: `resolve` is taken only out of a
conflict, and the log could not say "conflict" until ADR-0025. With that recorded, every move afk
can decide to make is one it can decide **from the log**, which is the whole of ADR-0019.

## Considered options

- **An action is a step a killed run can leave the log ready to start at.** Rejected as the rule,
  though it lands close to the same set. It is a rule about crash recovery rather than about the
  machine, so it would be re-argued at every new step, and it leaves the action set a thing the
  reader derives instead of a thing the reader reads.
- **Keep `merge` welded.** Rejected once ADR-0025 landed. It was welded because of a conflict the
  log could not express; with that gone, what remains is a service holding a sequence, which
  ADR-0019 puts in one function.

## Consequences

- One-to-one. A reader who knows the steps knows the actions, and a new step is a new action.
- The merge track's seriality now covers more actions rather than fewer. It is asserted where it
  was before (ADR-0006, ADR-0019).
- `resolve` spends the rebase's budget rather than one of its own: being a separate action does not
  make it a separate trip through the merge track (ADR-0012).
- ADR-0023's three actions are an instance of this rule rather than an exception to it.
