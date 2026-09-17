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
- **Add `plan` in the same move.** Deferred at first, then taken — see *`plan` follows, and takes a
  predicate with it* below. Planning happens before a run exists, so the question was what a log
  means before a run; the answer turned out to be a one-line predicate rather than a new rule.

## Consequences

- **The event log is no longer purely per-ticket.** A reader listing the whole log sees entries that
  name no ticket, and any formatter that prints `#${event.ticket}` must say so — the flow tests' did,
  and now renders run-level events without the prefix.
- All six agent roles now record what they consumed, so ADR-0027's table is dialled from the whole
  picture rather than part of it.
- `--resume` can tell a wedged writer from one that never started, which it could not before.
- The `pull-request` step has no budget and no retry. Nothing reads its attempts, because the run
  ends either way; if that ever changes, a budget is counted off its start events like any other
  step's (ADR-0022).

## `plan` follows, and takes a predicate with it

`plan` joined `STEPS` straight after, on the same terms: a run-level step whose events name no
ticket. What made it worth its own look was one line in `run-records.ts`, where `hasEventLog` asked
whether `events.jsonl` was on disk, and `refusalToStart` read that as **this spec has a run**.

Planning appends before any ticket is touched, so a `plan` event creates the file — and
`--plan-only` followed by `--implement-only`, the pairing the README documents for a run with no
TTY, would have started refusing itself with *"spec #N has a run already"*.

**A run is a ticket having been attempted.** `started(events)` is that predicate — any event naming
a ticket — and it replaces the file-existence check. `Records.events` became `Records.started`,
because the field no longer means what its old name said. The store stopped answering the question
at all: the domain reads the log and applies its own rule, which is where the rule belonged.

That file-existence check was already a proxy rather than the fact, and `plan` is only what made it
stop being a good one. Two fakes had been hiding the same kind of thing, and writing one end-to-end
test for the pairing found both:

- `createFakeRunRecords` carried its own `hasEvents` flag beside the event-log fake, so a test could
  seed a log full of ticket events while the store insisted there was no run — a state the real
  system cannot be in. It now takes the event log and empties it when the run directory goes, so the
  two agree by construction. Eight flow tests were resting on the old fiction and now pass
  `--resume`, which is what the CLI always required of them.
- `createFakeManifestStore` ignored its own writes, always answering with whatever it was seeded
  with. A real store round-trips, and a fake that does not cannot tell `--plan-only` followed by
  `--implement-only` from a spec nothing has planned — which is the one sequence this decision is
  about.

`--force-fresh` deletes a log holding only a plan, along with the rest of the run directory. A plan
event is a record of the run, not of the manifest, and the manifest survives on its own (ADR-0014).
