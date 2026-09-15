---
status: accepted
---

# The run's records are machine-local; GitHub receives exactly two writes

**Decision: `.afk/`** — state, worktrees, agent transcripts — **is machine-local and deliberately
not portable.** It lives on one machine and is never expected anywhere else. **GitHub is written to
exactly twice:** the ticket is claimed when its implementer starts, and the spec PR is opened at the
end.

## Consequences

- **Anything a second reader needs must reach the spec branch's commits, or it does not exist.**
  That constraint is load-bearing, not incidental: it is why a conflict resolution's prose lives in
  the ticket's squash commit body (ADR-0007).
- **No progress comments, no labels, and no conflict-resolution note on the ticket issue.** A
  comment pointing at a resolution that exists only in `.afk/` on one machine is worse than no
  comment at all.
- **A claimed ticket is never released**, `--force-fresh` included. An unassigned ticket looks
  unattempted; an attempted-and-failed one is exactly what you want to find later.
- **The two writes are what a *run* makes.** `--force-fresh` throws a run away rather than making
  one, and closing the pull request it opened is the undoing of one of the two rather than a third.
  It is closed before its head branch is deleted, because deleting the head closes it anyway — and
  afk would then be reporting there was nothing to close.
- Interaction worth knowing: `docs/agents/issue-tracker.md`'s *Frontier query* drops assigned
  issues, so an afk-claimed ticket is invisible to it for as long as the claim stands — which is
  correct, and which nobody would predict.
