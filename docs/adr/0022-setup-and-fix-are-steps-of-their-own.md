---
status: accepted
---

# Setup and fix are steps of their own

Two crash windows survived the rewrite, and both are the same shape: work that can be killed, or
work that has a budget, running under a step name that is not its own.

An implement attempt claims the ticket on the tracker, cuts its worktree, copies environment files
and runs `setup` — up to an hour of it (ADR-0021) — before its first event exists. A *failure* there
records both events; a *kill* records nothing, and ADR-0011's reading of that silence ("there is no
session to resume and nothing was attempted") is then false. The ticket is assigned on GitHub and
has a worktree on disk while the log calls it untouched, and because the budget is counted off start
events, the whole pre-agent phase can repeat across restarts without bound.

A fix attempt is recorded as a second **gate** attempt (ADR-0009). Nothing therefore counts fix
attempts, and a run killed between a red gate and its revert reads `gate: running`, is dispatched
back through the merge track, gates red again and spends a **second** fix. ADR-0009's "exactly one"
is asserted by control flow rather than derivable from the log — which is what the log exists to
stop.

**Decision: the `step` enum grows by `setup` and `fix`.** An implement attempt reads
`setup running → setup ok → implement running (sessionId) → implement ok`. A red gate reads
`gate running → gate failed → fix running → fix ok|failed`, and the budget is
`attempts(events, ticket, "fix")`.

The rule underneath both: **a phase that can be killed on its own, or that carries a budget of its
own, is a step of its own.** ADR-0011 has it that growing the enum is a deliberate act and not a
convenience; this is that act, and those two tests are what it has to pass.

**Nothing an attempt does happens before its start event.** Claiming, cutting a worktree, copying
secrets and installing dependencies are the acts of the `setup` step rather than the opening moves
of the implement step — so ADR-0011's "a step killed before its agent was spawned leaves no event
and reads as untouched" becomes true by construction instead of by luck: the untouched reading is
correct because there is now nothing it could have touched.

A `setup` event carries no `sessionId`, and that is not a hole in ADR-0017. `setup` runs the
repository's own commands, not an agent; an id in the log is one that was observed, and an attempt
that never had a session never had one to record. It is the first step whose attempts have no
session, and two events per attempt is unchanged.

## Considered options

- **Accept the unrecorded window and document it.** Rejected. It is not a window between two facts,
  it is an hour of tracker writes, disk writes and secret copies that the log denies happened, and
  documenting it would leave the budget uncountable across that hour.
- **Move the `sessionId` onto the end event**, so the start event can be written before the claim.
  Rejected. It keeps two events per attempt and closes the same window, but an attempt killed
  mid-agent then has no id anywhere — which is the one thing the start event exists to carry
  (ADR-0011, ADR-0017).
- **Count fix attempts off the gate's own events** — a second `gate running` after a `gate failed`
  is a fix. Rejected. It stores the budget in the shape of a neighbourhood rather than in a fact,
  and it asks every reader of the log to infer a step that could simply be named.

## Consequences

- **The claim happens inside a recorded step**, so a ticket assigned on the tracker always has an
  event. A claim that is refused still halts the run (ADR-0013); what changes is that a claim that
  succeeded and was then killed is visible.
- **The one fix attempt becomes derivable** — `attempts(events, ticket, "fix")` is the whole of it.
  ADR-0009's "recorded as a second gate attempt" is superseded by this record. The gate on the
  reverted tip is still recorded as the **revert**'s outcome, which is untouched: that is what keeps
  a reverted ticket from ending on `gate: ok` and reading as verified.
- A `setup` that fails is an ordinary failed step, exactly as its failure is today. What is new is
  that a `setup` that is *killed* leaves `setup: running` rather than silence.
- **Neither step is repairable, and neither is recovered by an agent.** A broken `setup` is recut
  (ADR-0024); a killed `fix` goes back to the gate, which is now a sequence the decision function
  owns (ADR-0023). Both were open when this record was written.
