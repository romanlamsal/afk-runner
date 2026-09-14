---
status: accepted
---

# A failed implementer gets one prepare pass and one more attempt

A run is unattended, and a ticket that cannot land takes every dependent with it — the skip is
transitive, so one stuck implementer silently costs a whole subtree of the DAG. Most implementer
failures are mechanical rather than substantive: a session that will not resume, a half-written
worktree, a process killed mid-step.

**Decision: on `implement:failed`, the prepare agent runs, then the implementer is attempted once
more. If that attempt fails, the ticket is failed for good and its dependents are skipped
transitively.** The prepare agent runs both mid-run and on `--resume`.

**Every `implement:failed` gets the same treatment.** The runner does not classify failures into
ones worth a prepare pass and ones that are not — that is a closed enum of failure reasons in
disguise, which ADR-0011 forbids.

On `--resume`, the prepare agent runs for **any ticket whose last event is not terminal** — including
one left at `running` by a killed run, which has no failure event at all and is the case a resumed
run most often finds.

The prepare agent, in both modes:

- **only ever prepares.** It never merges, never lands work, never touches the spec branch. It
  leaves the ticket in a state the normal track can pick up, and hands back;
- **never waits for a human.** The run is unattended and stays that way;
- **is instructed by the step that broke.** A ticket stuck at `rebase:failed` needs something
  different looked at than one stuck at `implement:failed`. It is broad by design, because it is the
  out-of-the-ordinary path, but it is never invoked without being told what to check for.

## Considered options

- **Keep the prepare agent off the unattended path entirely — skip mid-run, repair only on resume.**
  Rejected on cost asymmetry: one prepare call against the loss of a ticket and every ticket
  downstream of it. The concern behind that rule is real and is **accepted rather than answered** —
  a judgement-heavy agent now runs unattended. What bounds it is the list above plus the hard stop
  at one retry, not supervision.
- **Retry the implementer without a prepare pass.** Rejected. The retry that existed before was
  there because the no-commit signal was false (a resumed run's implementer correctly finds nothing
  to do); once the check measures branch position, a failure is a true signal and retrying it
  unchanged is waste. The prepare pass is what makes the second attempt different from the first.

## Consequences

- A failing ticket costs up to three agent invocations — implement, prepare, implement — before it
  is abandoned. That is the price of not losing its dependents.
- Resume dispatches on the last lifecycle event's step (ADR-0011).
- Failed tickets keep their branch, worktree and transcript rather than being cleaned up: that is
  what the prepare agent reads.
