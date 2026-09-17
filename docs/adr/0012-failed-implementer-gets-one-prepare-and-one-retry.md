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
transitively.** The prepare agent runs both mid-run and on a resumed run — which is the same thing,
because a resumed run is the ordinary loop against a log that is not empty (ADR-0019).

**Every `implement:failed` gets the same treatment.** The runner does not classify failures into
ones worth a prepare pass and ones that are not — that is a closed enum of failure reasons in
disguise, which ADR-0011 forbids.

The pass runs for **any ticket whose last event is not terminal** — including one left at `running`
by a killed run, which has no failure event at all and is the case a resumed run most often finds. A
`running` event is a step whose process is gone exactly when the driver's live action set does not
hold it, and on the first tick of any process that set is empty (ADR-0019).

The prepare agent:

- **only ever prepares.** It never merges, never lands work, never touches the spec branch. It
  leaves the ticket in a state the normal track can pick up, and hands back;
- **never waits for a human.** The run is unattended and stays that way;
- **may abort a rebase that is in its way.** The conflict resolver never aborts — that is the
  script's to do — and this is the second place an abort may happen: a leftover rebase a killed run
  or a resolver left behind is what the pass exists to clear (ADR-0005);
- **is instructed by the step that broke.** A ticket stuck at `rebase` needs something different
  looked at than one stuck at `implement`. It is broad by design, because it is the path taken when
  something has already gone wrong, but it is never invoked without being told what to check for.

## The per-step instruction

The step is the whole of what the instruction keys on. A step that broke is either a failure an
agent reported or a process a killed run left behind, and the worktree does not say which — so each
instruction covers both readings rather than afk guessing between them and instructing for the wrong
one.

| broken step | what the pass is told to look at |
| --- | --- |
| `implement` | How far the implementer got: what is committed on the branch, what is uncommitted, what is half-written. Leave branch and worktree fit for another implementer to carry on from |
| `rebase` | A rebase onto the spec branch that did not land. Abort one that is in the way; leave a clean checkout of the ticket's branch with the ticket's own commits still on it |
| `resolve` | A rebase a conflict resolver left unresolved. Abort it rather than finishing it — resolving is not the pass's job — and leave the ticket's own commits intact |
| `merge` | A squash that may or may not have landed. Leave the branch fit to be rebased and squashed again, and go nowhere near the spec branch: afk checks what landed itself |
| `gate` | Work that is already on the spec branch, and checks that were killed part-way. Nothing to put right in the ticket's worktree beyond leaving it clean |

Two steps are **not** on this table, and neither is an omission. `prepare` is never the thing that
broke — a pass that was itself killed is still about whatever it was sent to, so the step underneath
it is what the next pass is instructed by. `revert` is not repaired at all: a ticket whose merge was
being taken back off the spec branch was already on its way out, and putting it back is the one
thing recovery must not do (ADR-0009). A ticket a killed run left mid-revert therefore keeps
`revert:running` as its status for good: it dooms its dependents like any other ticket nothing more
will happen to, and it is deliberately left reading as the step it died in rather than being
rewritten into a failure afk did not witness.

A ticket that has no worktree — because its start never got as far as cutting one — is not sent a
pass at all. There is nothing in it to prepare, and the attempt the pass entitles it to cuts a fresh
one anyway; the pass is still written down, because the retry is read off the log and nothing else.

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
- **The budget is counted, never stored**: a step gets its attempt and one more, read off the start
  events the log already carries (ADR-0011). The merge track has the same budget, and a failed
  `resolve` spends the rebase's rather than one of its own, because what is being spent is the
  ticket's second trip through that track.
- **A stale step is always repaired, whatever the budget says.** A killed process never answered its
  attempt, so a pass is sent to it even where the budget is spent — otherwise an interrupted run
  could not pick its own work back up, which is the thing this record exists for. What a killed
  attempt does not buy is an *extra* one: it is counted like any other, because afk cannot know how
  far it got, and the cost bound above is what makes a judgement-heavy agent safe to run unattended.
- The attempt a pass buys **continues the session the attempt before it was given**, where one was
  observed, and starts fresh where none was. afk never generates a session id (ADR-0017).
- A pass that fails ends the ticket: the second attempt is only different from the first because a
  pass went through in between, and a pass that got nowhere has not made it different.
- Failed tickets keep their branch, worktree and transcript rather than being cleaned up: that is
  what the prepare agent reads.
