---
status: accepted
---

# A resumption is a run boundary, not a step

A replay draws every moment between two log lines as one where a process held the run, and counts a
running step's elapsed figure up across the gap. Ctrl+C before an implementer took off, and a resume
a day later, replayed as an implementer that took more than twelve hours. The live board never
shows this: with nobody holding the run's lock it draws the step *interrupted*, with no figure
(ADR-0034). A log cannot say that the process holding the run went away, so a replay cannot either.

**Decision: a start that continues a consented run appends a run boundary — a resumption — before
anything is dispatched.** The line is `{"boundary": "resumption", "at": "<iso>"}`. It is written when
`records.started && consented`, which is the same test that makes `--resume` mandatory (ADR-0014).
`--plan-only` followed by `--implement-only` is a change of phase and writes nothing.

- **It is not a lifecycle event.** It has no step and no outcome, and it moves no status. The log's
  derivations — `nextActions`, the board, the cost script — read lifecycle events only, and
  `readEvent` already drops any line that is not one. `EventLog.read` is unchanged; the replay gets a
  reader of its own that returns the records in order.
- **Only a resumption is written, never a pause.** A drain records every end event and so leaves no
  open step to misdraw. The stops that leave one — a second interrupt, `kill -9`, a crash, power
  loss — cannot write anything (ADR-0016). A pause would exist only on the path that does not need
  it.
- **The replay looks one line ahead.** A gap whose next record is a resumption is drawn with
  `live: false`: steps left running read *interrupted* and carry no figure, the gap is not ticked,
  and one `TICK_MS` is held on that frame. A step's figure restarts from the new attempt's own start
  event. `--lines` draws no line for the record itself, but the interrupted frame is a change like any
  other, so the step reads `interrupted` and then `running` again.
- **The stop instant is unknown and stays so.** Nothing is inferred from `at` gaps, so a log written
  before this record existed replays as it did.

## Considered options

- **A `resume` step.** Rejected: ADR-0022 admits a step for being killable or carrying a budget, and
  a resumption is neither. Admitting it would loosen a test that is correct as it stands.
- **A pause and a resume.** Rejected, above: the pause is unwritable exactly when it matters.
- **A gap threshold in the replay.** Rejected: it branches on `at`, which nothing does (ADR-0011),
  and it draws a long-running implementer as a stopped one.

## Consequences

- The log holds a second record shape. An afk older than this ADR reads a newer log by skipping it.
- A resumption is evidence the previous process is gone, not when. Nothing may treat its instant as
  the moment the run stopped.
- A second boundary form — a takeover, say — is a new value of `boundary`, not a new shape.
