---
status: accepted
---

# Ticket status is derived from an append-only event log

An earlier runner stored a status enum per ticket *and* asked GitHub what had landed. Two
representations of one fact is how they came to disagree.

**Decision: `state.json` holds, per ticket, an append-only log of lifecycle events** — the step, its
outcome, a timestamp, free-text detail, and a pointer to the agent transcript. **Status is the last
event. It is derived on read and never stored.**

`step` is closed: `implement → rebase → resolve → merge → gate`, plus `revert` when the gate goes
red. `outcome` is `ok | failed | skipped`.

## Considered options

- **A closed enum of failure reasons.** Rejected. A laptop that slept, a connection that dropped, a
  rebase that would not land and a gate that went red are not usefully the same shape, and guessing
  the set before hitting it is how folklore starts. **The step is what recovery keys on**; `detail`
  is free text and is never branched on.

## Consequences

- The `step` enum being closed is what makes recovery dispatchable (ADR-0012). Adding to it is a
  deliberate act, not a convenience.
- **The event log is the record of what was attempted and how far it got.** The spec branch's log,
  queried by the `afk-ticket` trailer, is the **cross-check for what landed** — a git fact,
  checkable from a fresh clone with no state file. It is a cross-check and not the dispatcher: a
  commit says a ticket landed, never which step failed or why.
- **No step may measure what happened during an invocation** — whether HEAD moved while an agent
  ran, say — instead of what is on the branch. An idempotent agent that correctly finds nothing left
  to do is the expected case on a resumed run, not a failure.
