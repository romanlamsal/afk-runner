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

## Amendment: the flag surface the confirmation sits in

The confirmation is the bare invocation's middle step, so the flags that decide whether it happens
are recorded here.

| invocation | meaning |
| --- | --- |
| bare | plan, confirm, implement. Refuses when a manifest or an event log already exists, naming the mode to use |
| `--plan-only` | run the planner, write the manifest, print the execution order, exit |
| `--implement-only` | manifest required; refuses an existing event log unless consent is given |
| `--resume` | **consent only.** It changes no behaviour, it acknowledges an existing run |
| `--force-fresh` | delete this spec's branches, run directory and pull request. No prompt: the flag is the consent |
| `--max-parallel <n>` | implementer slots, default 3 |

`--plan-only` and `--implement-only` name different halves of a run and cannot be combined. Neither
can `--force-fresh` and `--implement-only`: the manifest lives in the run directory, so starting over
deletes the very thing `--implement-only` requires. **Arguments** afk refuses exit `2`. Refusing
to *start* is `3`: the arguments were fine and what went wrong is on disk, and the README's exit
code table is the single statement of that split.

**`--dry-run` is deleted.** Printing the execution order under `--plan-only` serves what it was
for, and simulating a run would be a second execution path that nothing else exercises.

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
