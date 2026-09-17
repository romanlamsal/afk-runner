---
status: accepted
---

# Ticket status is derived from an append-only event log

An earlier runner stored a status enum per ticket *and* asked GitHub what had landed. Two
representations of one fact is how they came to disagree.

**Decision: `events.jsonl` holds an append-only log of lifecycle events** — the ticket, the step, its
outcome, a timestamp, the attempt's `sessionId`, the `baseSha` a worktree was cut from, free-text
detail, and a pointer to the agent transcript. **Status is the last event. It is derived on read and
never stored.**

**The format is one JSON object per line, opened for append** — not one JSON document rewritten on
every change. The format *is* the durability argument: a line is written whole or it is not, so a
run killed mid-write costs the last line and never the file, and a line that does not parse is
dropped on read rather than failing everything before it. Rewriting a whole document to record one
event puts the entire history in the crash window, every time.

`step` is closed: `setup → implement → rebase → resolve → merge → gate`, plus `fix` when the gate
goes red, `revert` when the fix does not save it, and `prepare` when a step is recovered (ADR-0012,
ADR-0022). `outcome` is `running | ok | failed | skipped`.

**An event is appended when a step starts, and a second when it ends.** The start event carries
`running` and the attempt's `sessionId` as soon as that id is observed (ADR-0017); the end event
carries the settled outcome. Nothing is ever rewritten — settling an outcome means appending, not
editing.

**Exactly two events per attempt, which is what makes the start event's `sessionId` possible at
all.** Append-only and "the start event carries the id" can only both hold if the start event is
written at the moment the id is observed — which is before any model work, because every line of
the stream carries it, including the first. An attempt whose stream carried no id never started one,
and still gets its start event, so the pair is invariant. A step killed before its agent was spawned
leaves no event and reads as untouched, which is correct: there is no session to resume and nothing
was attempted. That last reading only holds because **nothing an attempt does happens before its
start event** — work with a kill of its own to survive is a step with a name of its own, which is
what `setup` is (ADR-0022).

**`sessionId` belongs to the attempt, not to the ticket.** An implementer's session is not its
conflict resolver's, and a retried implementer's is not its first attempt's.

## Considered options

- **A closed enum of failure reasons.** Rejected. A laptop that slept, a connection that dropped, a
  rebase that would not land and a gate that went red are not usefully the same shape, and guessing
  the set before hitting it is how folklore starts. **The step is what recovery keys on**; `detail`
  is free text and is never branched on.
- **Write the event only when the step ends.** Rejected. A run killed mid-step then leaves no record
  that the step ever began — no `running`, no `sessionId`, nothing to resume — which is the crash
  window this log exists to close.

## Consequences

- **A killed run leaves `running`, which is a visible state rather than an inferred one.** That is
  what a resumed run dispatches on for a ticket that was mid-step, and it is the case a resumed run
  most often finds. A `running` event is *only* stale when the driver's live action set says so
  (ADR-0019) — the log alone cannot tell a step that is running from one that was.
- **Attempt counts are derived by counting start events.** Nothing stores a counter, so nothing can
  hold one that disagrees with the log.
- The `step` enum being closed is what makes recovery dispatchable (ADR-0012). Adding to it is a
  deliberate act, not a convenience.
- **The event log is the record of what was attempted and how far it got.** The spec branch's log,
  queried by the `afk-ticket` trailer, is the **cross-check for what landed** — a git fact,
  checkable from a fresh clone with no state file. It is a cross-check and not the dispatcher: a
  commit says a ticket landed, never which step failed or why.
- **In one window the cross-check is load-bearing, and that is not a contradiction.** A run killed
  between the squash returning and its `merge: ok` being written leaves `merge: running`, and no
  event can tell "the squash landed, the record did not" from "the squash never ran". Git is the
  only witness there, so the merge track asks it before rebasing. Reproduced against real git: the
  ticket's rebase onto a spec branch that already carries its squash **conflicts with its own landed
  work**, which spends a conflict resolver call on it and squashes the result a second time. The
  check is a correctness guard, not an optimisation — what it still may not do is say *which*
  ticket to take next.
- **No step may measure what happened during an invocation** — whether HEAD moved while an agent
  ran, say — instead of what is on the branch. An idempotent agent that correctly finds nothing left
  to do is the expected case on a resumed run, not a failure.
