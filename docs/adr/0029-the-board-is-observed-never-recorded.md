---
status: superseded in part by ADR-0030
---

# The board is observed, never recorded

A run says what it is about to do, then goes quiet until the pull request link. Everything in
between reaches the operator only as `events.jsonl`, and the way to watch a run was to tail that
file through `jq` in a second terminal and build the view by hand, every time.

**Decision: afk shows a board while it runs, and writes nothing down for it.**

The board is the live view of a run: every ticket of the spec at once, each on the track it is
currently on. It is derived from the manifest, the event log **and** the driver's live action set,
which are the same three inputs `nextActions` takes. It is the second pure function of them.

**The live action set is not optional.** ADR-0019's mechanism is the whole reason: a `running` event
whose action is in `inFlight` is a step that is happening, and one whose action is not is a step
whose process is gone. A board built from the log alone would paint a killed run's leavings as work
in progress, and the first frame of a resumed run is exactly that case. The log records what was
attempted. It does not claim anything is still going on.

**Nothing is recorded because liveness is not recordable.** A crashed process cannot retract its own
heartbeat. Any file afk wrote to say "ticket 22 is gating" would go stale in precisely the way a
`running` event already does, and reading it would need the same qualifier that only a live process
holds. So a second process watching from outside would be guessing no matter what afk wrote down.
Writing nothing costs nothing that could have worked, and it keeps the event log the only state afk
keeps (ADR-0011).

The consequence is deliberate: **afk has no watcher.** A second terminal tails the event log, which
is honest about what it is.

## Considered options

- **Feed the board by decorating `EventLog.append`.** Rejected, and it is the one that looks right:
  one mechanism, every service already appends. But appends are the log, and the log cannot say what
  is happening. Worse, a resumed run's board would start blank, because the events describing its
  stale work were appended by a process that is gone.
- **Write a liveness record beside the log so a second process could watch.** Rejected twice over.
  It is two representations of one fact, which is the fault ADR-0011 exists to prevent, and it
  cannot work anyway for the reason above.
- **Tail the log in a subprocess and render from there.** Rejected. Same blindness as the decorator,
  plus a second process to start, supervise and kill.
- **Keep the `jq` pipeline and print nothing.** Rejected. It is what exists. It cannot show what a
  resume is about to do, and it makes the operator rebuild the view on every run.

## Consequences

- **`boardOf` joins `progressOf` as an operator-facing derivation in the domain.** Both classify a
  ticket's terminal state, and `progressOf` already feeds the exit code and the pull request's draft
  flag. That classification therefore lives in one place: a board disagreeing with the exit code
  about whether a spec finished would be worse than no board at all (`layers.md`, question 3).
- **`repairFor` is lifted out of `nextActions` and exported.** It closes over the event log and
  nothing else, so the move is free. It is what lets the board show a ticket whose process is gone
  as interrupted, with the repair a resume will give it, which is the one thing the log alone cannot
  show.
- **The board owns the terminal for the drive's duration**, so the drain notice routes through it
  rather than to stderr. Two writers to one terminal is not a design choice.
- **No elapsed times and no spinner.** The board holds no clock and redraws when the run's state
  changes. Because every merge-track step is an action of its own (ADR-0026), the driver loop goes
  around at each step boundary and the frame keeps up without one.
- Off a terminal the same driven port takes a line adapter instead, which is the `jq` pipeline built
  in. A port with two adapters is the ordinary case (`layers.md`).
- Nothing in `.afk/` changes, and `--force-fresh` has nothing new to take away.
