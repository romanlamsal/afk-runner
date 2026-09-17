---
status: accepted
---

# The planner is an agent, not a parser

The manifest's tickets and their blocked-by edges are the entire schedule: every scheduling decision
the runner makes derives from them. **Both** are repository conventions, not tracker features.
Which issues belong to a spec is recorded as native sub-issues in one repository, as a task list in
the spec's body in another, and as a `Part of #<spec>` line in each ticket in a third; where the
edges are recorded differs the same way — native issue dependencies, a prose section in the body, a
single line at the top. afk piggybacks the mattpocock engineering skills, so a repository that uses
afk already documents its own conventions under `docs/agents/`.

**Decision: the planner is an agent.** It reads that documentation, works out from it **which issues
are the spec's tickets** and **how they block each other**, and emits the manifest — including the
two commands the run needs, `setup` and `verify`.

**Sub-issues are not assumed.** A runner that lists sub-issues and finds none cannot tell a spec
with no tickets from a repository that records membership another way, and the two call for
opposite responses.

## Considered options

- **A parser per tracker.** Rejected. A parser encodes one repository's convention and, on a
  repository that uses another, returns a *plausible but wrong* DAG rather than an error. Nothing
  downstream can detect a wrong edge: the schedule simply runs in the wrong order and the failure
  surfaces as unexplained conflicts.
- **Sub-issues for membership, the agent for edges only.** Rejected. It is the parser argument with
  a smaller blast radius: a repository that records membership in prose gets an empty run, and an
  empty run reads as a finished spec.

## Consequences

- afk holds no copy of any repository's conventions, so there is nothing inside afk to fall out of
  date when they change.
- One agent call per run is spent on planning. A manifest lives minutes to hours, so re-deriving it
  each run is not waste worth engineering around. See ADR-0014.
- Membership is the spec's *open* tickets: a closed one has already landed, and re-implementing it
  is the one mistake a plan cannot recover from. Which tickets an agent may take at all is the
  repository's own triage convention, read from its documentation like everything else here — afk
  holds no label names. Neither is a judgement about scope or granularity, which stay the ticketing
  skill's (ADR-0002).
- The planner's output is read as a claim, never as a fact: afk validates it against the manifest
  schema, refuses a manifest planned for another spec, refuses the same ticket twice, and refuses a
  set of tickets that cannot start. What afk cannot check is whether an edge is *true*.
- Whether a repository documents its conventions well is not a checkable predicate, so it is a
  documented precondition rather than a refusal.
