---
status: accepted
---

# The board is derived from the run directory

ADR-0030 made the board a pure function of the manifest and the event log, and gave it no clock: the
frame carried the last event's timestamp and nothing else about time. That held until run 1117. Its
runner drew one frame per pass of its loop, the last frame was drawn before the fix was dispatched,
and it sat on screen, unmoving, for the minute the fix agent worked. The operator read a frozen
board with a red gate on it as a dead ticket and killed a run that was repairing itself (#52).

Nothing on that frame said a step was in progress, because nothing the board was allowed to read
could say it. A log holds when a step began, never that it is still going.

**Decision: the board is derived from what the run directory holds, and from an instant handed to
it — never from the driver's in-flight action set.**

This supersedes ADR-0030's letter and keeps its principle. The principle was that anything able to
read the run directory draws the same board; the letter was that the log is all it reads. The
letter goes, because the evidence that a step is alive lives beside the log rather than in it — the
transcripts an agent writes, the output a command writes, the lock a live run holds — and the view
cannot say what it may not read. The principle stays: the in-flight set is still the driver's alone,
and nothing the board reads is anything but a file under `.afk/`.

**The first thing it buys is an elapsed figure.** Every row ends in how long its running step has
been going — `| 58s` — counted from the step's start event to the instant the view is derived at,
and a row with nothing running shows no figure. `boardOf` takes that instant as a parameter rather
than reading a clock: the runner and `--board-only` pass the time now, and a replay passes the
replayed instant, so a replayed board shows the number the live one did.

**It says how long, and never whether.** A step whose process is gone counts up exactly like one
that is working, which is what ADR-0030 asked of the board and still does. Whether a step is alive
is a separate question, answered from what the step itself wrote and carried by colour (ADR-0031).

## Considered options

- **Append heartbeat events, so the log alone can say a step is alive.** Rejected. The log is a
  record of what was attempted (ADR-0011), a crashed process cannot retract its last heartbeat, and
  a reader would have to filter telemetry out of every derivation that reads the log.
- **Read the driver's in-flight set again, as ADR-0029 did.** Rejected, for ADR-0030's reason: it
  makes the board drawable only inside the process running it.
- **Keep the board clockless and only redraw more often.** Rejected. Redrawing a frame that says the
  same thing does not tell a step that just began from one twenty minutes in.

## Consequences

- **`boardOf` takes a third parameter**, the instant, and a row gains `elapsed`. The view is still
  pure: the same manifest, log and instant are the same view wherever they are drawn.
- **The footer's timestamp is unchanged.** It is still read off the last event, and still says whose
  time it is; the instant handed in is used for the elapsed figure and nothing else.
- **The frame's height is still the ticket count.** The figure goes at the row's end, after
  `waiting` and `dead`, so its width changing moves nothing but itself and the trail's words stay
  where ADR-0031 put them.
- **The board's inputs grow one file at a time.** Transcripts and command logs for silence, and the
  lock for whether the run is alive at all, arrive with the tickets that need them; each is read off
  the run directory, and none is the driver's.
- **One watch owns redrawing.** A figure that only updates when something settles is not a figure,
  so the runner no longer draws once per pass of its loop. A single watch service wakes on a change
  to the log and on a one-second tick, derives the view afresh and draws it; the runner and
  `--board-only` both drive through it, so two terminals showing one run redraw on the same terms.
  A tick appends nothing: the log stays a record of what was attempted (ADR-0011).
- **Silence is the second thing it buys.** A new driven port, `Activity`, answers when the step
  writing to a path last wrote, no later than a given instant, with one method over the run
  directory. It reads the step's own records — the `timestamp` an agent's transcript records carry,
  and the instant each line of a command log opens with — so an agent step and a command step are
  read the same way, and never a modification time a replay could not reconstruct. The watch reads
  them on every wake, tick included — a step goes quiet by writing nothing, so no change to the log
  says so — and `boardOf` takes those writes beside the instant, and a row gains `quiet`: running, and nothing written for longer
  than `QUIET_AFTER_MS`, counted from the step's start where it has written nothing yet. A view
  handed no writes claims no silence, which is what a replay draws until it reads the transcripts.
