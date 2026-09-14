---
status: accepted
---

# Session ids are observed, never asserted

Agent sessions are resumable, which is what lets a resumed run continue an implementer rather than
restart it. The obvious implementation generates a UUID up front, passes it as `--session-id`, and
records it — the state file is then self-describing before the process even starts.

It is also wrong in a way that costs an agent call per ticket per resumed run. `--session-id`
refuses an id that already exists, exactly as `--resume` refuses one that does not, so the runner
has to know whether the session was ever created — and a pre-generated id records only that the
runner *intended* to create one. A run killed between writing the id and spawning the process
records a session that does not exist; a resumed run records one that does. Inferring which from the
ticket's status is guessing.

**Decision: the runner does not pass `--session-id`.** The CLI mints the id, and the runner reads it
back out of the transcript it is already writing to disk, recording it on the attempt's `running`
event (ADR-0011). An id in the log therefore means a session that exists. Resume passes
`--resume <id>` when one is recorded and starts fresh when none is.

This is verified, not assumed: under `-p --output-format stream-json --verbose` every line carries
`session_id`, including the first — a `rate_limit_event` emitted before `system/init` and before any
model work.

## Considered options

- **Pre-generate the id and pass `--session-id`.** Rejected: see above. It is what the superseded
  implementation does.
- **Derive the id deterministically from `(spec, ticket, step, attempt)`.** Rejected. It removes the
  need to store the id but not the need to know whether the session exists, which is the actual
  problem.

## Consequences

- The window between spawning a process and having a recorded id is milliseconds rather than the
  length of an agent run, and it is a window in which *no* session exists — so a run killed inside
  it resumes correctly by starting fresh.
- The runner must parse the transcript stream rather than only stream it to a file.
