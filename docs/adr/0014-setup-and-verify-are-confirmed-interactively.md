---
status: accepted
---

# `setup` and `verify` are confirmed interactively, or the run refuses to start

`setup` and `verify` are arbitrary strings, authored by an agent (ADR-0003), that will run on the
user's machine.

**Decision: between the planner and the first implementer, an interactive step shows both for
editing.** With no TTY and no explicit plan-only or implement-only invocation, the run **exits
non-zero naming both flags**. It never auto-continues. The DAG is *not* editable here — the planner
is trusted to map tickets from issues correctly.

## Considered options

- **Prove `verify` works by running it on a clean checkout of the default branch during preflight.**
  Rejected outright: running a discovered command in order to check it is arbitrary code execution,
  not a safety check.
- **Auto-continue when there is no TTY.** Rejected. A mode that skips the confirmation when nobody
  is watching is precisely the mode that runs the wrong command unsupervised.
- **Remember the confirmed pair per repository and pre-fill it on later runs.** Rejected as
  unnecessary: a manifest lives minutes to hours, not weeks, so re-deriving the commands each run is
  not a cost worth carrying state for.

## Consequences

- **This confirmation is the only thing standing between a planner-authored string and execution.**
  Accepted risk, not a solved problem.
