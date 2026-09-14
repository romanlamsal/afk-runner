---
status: accepted
---

# The planner is an agent, not a parser

The manifest's blocked-by edges are the entire schedule: every scheduling decision the runner makes
derives from them. Where those edges are recorded differs per repository — native issue
dependencies, a prose section in the body, a single line at the top — and afk piggybacks the
mattpocock engineering skills, so a repository that uses afk already documents its own conventions
under `docs/agents/`.

**Decision: the planner is an agent.** It reads that documentation and the spec's sub-issues,
comprehends how this repository records dependencies, and emits the manifest — including the two
commands the run needs, `setup` and `verify`.

## Considered options

- **A parser per tracker.** Rejected. A parser encodes one repository's convention and, on a
  repository that uses another, returns a *plausible but wrong* DAG rather than an error. Nothing
  downstream can detect a wrong edge: the schedule simply runs in the wrong order and the failure
  surfaces as unexplained conflicts.

## Consequences

- afk holds no copy of any repository's conventions, so there is nothing inside afk to fall out of
  date when they change.
- One agent call per run is spent on planning. A manifest lives minutes to hours, so re-deriving it
  each run is not waste worth engineering around. See ADR-0014.
