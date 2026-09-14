---
status: accepted
---

# Ticket status is derived from an append-only event log

An earlier runner stored a status enum per ticket *and* asked GitHub what had landed. Two
representations of one fact is how they came to disagree.

**Decision: `state.json` holds, per ticket, an append-only log of lifecycle events** — the step, its
outcome, a timestamp, the attempt's `sessionId`, free-text detail, and a pointer to the agent
transcript. **Status is the last event. It is derived on read and never stored.**

`step` is closed: `implement → rebase → resolve → merge → gate`, plus `revert` when the gate goes
red. `outcome` is `running | ok | failed | skipped`.

**An event is appended when a step starts, and a second when it ends.** The start event carries
`running` and the attempt's `sessionId` as soon as that id is observed (ADR-0017); the end event
carries the settled outcome. Nothing is ever rewritten — settling an outcome means appending, not
editing.

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
  most often finds.
- The `step` enum being closed is what makes recovery dispatchable (ADR-0012). Adding to it is a
  deliberate act, not a convenience.
- **The event log is the record of what was attempted and how far it got.** The spec branch's log,
  queried by the `afk-ticket` trailer, is the **cross-check for what landed** — a git fact,
  checkable from a fresh clone with no state file. It is a cross-check and not the dispatcher: a
  commit says a ticket landed, never which step failed or why.
- **No step may measure what happened during an invocation** — whether HEAD moved while an agent
  ran, say — instead of what is on the branch. An idempotent agent that correctly finds nothing left
  to do is the expected case on a resumed run, not a failure.
