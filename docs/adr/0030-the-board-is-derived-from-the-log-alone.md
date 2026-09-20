---
status: superseded by ADR-0034
---

# The board is derived from the log alone

> **Superseded by ADR-0034.** The board now reads the run directory rather than the log alone, and is
> handed an instant to count a running step's elapsed time to. The principle stands: anything able to
> read the run directory draws the same board, and the driver's in-flight set is not part of it.
>
> **"Three states require no guess; four forced one" no longer holds**, and that section is the part
> of this decision that is actually reversed. It was true while the only witness to liveness was the
> driver's in-flight set. The run lock is a second witness, it lives in the run directory, and it
> answers for the run rather than for a step — so the fourth weight, `interrupted`, is read rather
> than guessed, and ADR-0034's last consequence is where it is decided.

ADR-0029 gave the board three inputs: the manifest, the event log and the driver's live action set.
The third was not optional. A `running` event whose action the driver holds is a step that is
happening; one whose action it does not hold is a step whose process is gone. The board told those
two apart, and only a process holding its own actions can. So the board could exist nowhere but
inside the run, and afk had no watcher.

The distinction was real. What went unexamined is whether the board needed to draw it.

**Decision: the board says what the log says, and claims nothing about liveness.**

`live` and `interrupted` collapse into one state, `running`: the log holds a start event for this
step and no end event. That is a fact about the log, and any reader of the log can establish it.
`boardOf` loses its third parameter and becomes a pure function of the manifest and the event log.

**The distinction stays where it is needed.** The driver still tells a live step from an interrupted
one, because it decides what to dispatch and cannot decide without knowing. `nextActions`,
`repairFor` and ADR-0019's mechanism are untouched, and **Interrupted** remains a term of the
domain. Only the view stops needing it. Scheduling keeps the distinction because it must; display
drops it because it needn't.

**Three states require no guess; four forced one.** A board with `live` and `interrupted` in its
vocabulary has to choose between them for every trailing `running`, and choosing requires knowledge
only the driver holds. Rendering such a step `interrupted` while its process is alive is not a
degraded view, it is a false statement — and next to a running `setup`, `fix` or `revert`, none of
which are in `BROKEN_STEPS`, it would have read "beyond repair". Collapsing the two removes the
question rather than answering it.

**What the operator loses, context supplies.** Watching a run you started, a trailing `running` is
live. Reading a run that is over, it is interrupted. The board stops guessing on the operator's
behalf, and the frame carries the last event's timestamp so that a log which stopped moving says so
without anything claiming it is still going.

**The board becomes watchable, because it became a reading of two files.** `afk <spec> --board-only`
renders the same frame from the run directory and follows the log, and stops when the log says the
run concluded. It is a flag rather than a command because `--plan-only` is: a mode that does one
narrow thing and exits.

## Considered options

- **Record the driver's live action set beside the log.** Rejected, as ADR-0029 rejected it, for the
  reason that still holds: liveness is not recordable, and a crashed process cannot retract its own
  heartbeat.
- **Carry the runner's identity on every event and ask the kernel whether that runner is alive.**
  Rejected, and it would have worked: provenance never goes stale, and an advisory lock is released
  by the kernel on any death, including a kill. It reconstructs the live action set exactly. But it
  buys back a distinction the board turned out not to need, and charges a new field on every event,
  a lock file in `.afk/`, and a second thing that has to agree with the log for it.
- **Keep `interrupted` by pairing start and end events by time.** Rejected. It is exact in the
  interior of a completed log — a step that started before T and ended after T was live at T — and
  unsound at the tail, where the end event has not been written yet and may never be. A replay only
  ever reads the interior, so it looks correct; the same code aimed at a growing file is wrong in
  every frame it draws, with nothing in the code to mark the difference.
- **Leave the board in the process and add nothing.** Rejected. It is what exists, and it cannot
  show a run that is over, which is the view wanted most often after a run is killed.

## Consequences

- **`STEP_STATES` goes from four to three.** `settled`, `running`, `ahead`. `boardOf` takes the
  manifest and the log, and `drive` no longer passes its live action set to it.
- **`beyondRepair` leaves the board.** It meant "interrupted, and no pass would help", so without
  `interrupted` it can only be a claim about a step that may be running perfectly. The fact is not
  lost: the driver still asks `repairFor`, and an unrepairable ticket reaches a `conclusion` the
  moment the driver decides.
- **`repairFor` stays exported.** ADR-0029 lifted it out of `nextActions` for the board; the board
  no longer calls it, but `decide.ts` does, and it remains the one place the rule lives.
- **The runner still draws.** The drive loop already reads the whole log at the top of every pass,
  so the frame costs no extra read and is built from the same bytes `nextActions` is given. Terminal
  ownership is therefore unchanged: the board still owns it for the drive's duration, the drain
  notice still routes through it, and the bucket summary is still suppressed when a frame was drawn.
- **`boardLines` is unchanged**, and stays what a piped run and CI get.
- **`--board-only` refuses a spec with no manifest.** The row set and the frame's height come from
  the manifest, so without one there is no board to draw. With a manifest and an empty log it draws
  the whole slate, every step ahead.
- **The board still holds no clock.** The frame shows the last event's timestamp, which is read off
  the event. ADR-0029's "no elapsed times and no spinner" stands as written; only its reason for
  having no watcher does not.
- **Nothing in `.afk/` changes**, and `--force-fresh` still has nothing new to take away.
