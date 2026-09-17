---
status: accepted
---

# A run-level step names no ticket

ADR-0027 put what an attempt consumed on its step's end event, so that "which role burns the
allowance" is a reading rather than an argument. Two of the six agent roles then had nowhere to put
it: the planner and the pull request writer run agents, hold sessions and spend tokens, but `STEPS`
named only moves in one ticket's machine, so neither service wrote a lifecycle event at all.

The pull request writer is the one that had to be fixed. It runs inside a run, after the gate has
proven what it is writing about, and it is the last agent a run invokes — so a run whose writer
wedged or died left a log that said nothing about it, and `--resume` had nothing to read.

**Decision: `STEPS` gains `pull-request`, and its events carry no ticket.** `ticket` becomes optional
on the lifecycle event, absent for a run-level step.

This is the mirror of something already true one layer up. ADR-0026 made the action set the step set
"plus `skip` and `finish`, which are about the run rather than about one ticket's machine", and
`{ kind: "finish" }` already carries no ticket. `pull-request` is the step that action takes.

What makes an absent ticket safe rather than a hole is that **every ticket-keyed derivation matches
the ticket against a number** — `statusOf`, `attempts`, `verified`, `brokenStep`, `sessionOf`, all of
them filter `event.ticket === ticket`. A ticketless event matches none of them, so it cannot become
a ticket's status, cannot be counted against a ticket's budget, and cannot be mistaken for the step
a prepare pass repairs. Not one derivation changed to accommodate it.

`pull-request` is deliberately **not** in `BROKEN_STEPS`, for the reason `revert` is not: a prepare
pass is only ever sent to a step it has an instruction for, and there is no instruction for repairing
a pull request that was not opened (ADR-0012). A writer that fails is recorded as failing and the run
opens the pull request anyway, prose or none — the log records attempts, not verdicts.

## Considered options

- **Leave the writer unrecorded, as before.** Rejected. It is an agent with a session and a budget's
  worth of consumption, and ADR-0027's whole point is that the log is where a profile gets dialled
  from. An agent nobody can account for is an agent nobody can make cheaper.
- **Give the event the spec number in the ticket field.** Rejected, and this is the one that would
  have hurt. A spec is not a ticket (`CONTEXT.md`), and worse, `statusOf` would then return the
  pull-request event for a ticket numbered the same as the spec, which `verified()` reads — so a
  verified ticket could silently stop being verified. The collision is unlikely and the failure is
  catastrophic, which is the worst combination.
- **A sentinel ticket, `0` or `-1`.** Rejected. `z.int().positive()` forbids it by design, and a
  sentinel is a value every reader must know to exclude, where an absent field excludes itself.
- **A second file for run-level records.** Rejected. Two logs for one run is two orderings of one
  sequence, and the append-only single file is what makes a torn write cost one line (ADR-0011).
- **Add `plan` in the same move.** Deferred, not refused. Planning happens before a run exists —
  `--plan-only` writes a manifest and exits — so a `plan` event would live in a log that describes a
  run that may never start. It is a real gap and the planner's consumption is still unaccounted for;
  it wants its own decision about what a log means before a run.

## Consequences

- **The event log is no longer purely per-ticket.** A reader listing the whole log sees one entry
  that names no ticket, and any formatter that prints `#${event.ticket}` must say so — the flow
  tests' did, and now renders run-level events without the prefix.
- Five of the six agent roles now record what they consumed. The planner is the sixth and is not
  covered; ADR-0027's table is dialled from an incomplete picture until it is.
- `--resume` can tell a wedged writer from one that never started, which it could not before.
- The `pull-request` step has no budget and no retry. Nothing reads its attempts, because the run
  ends either way; if that ever changes, a budget is counted off its start events like any other
  step's (ADR-0022).
