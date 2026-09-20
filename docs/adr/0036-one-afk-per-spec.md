---
status: accepted
---

# One afk per spec

ADR-0006 made one worktree the sole writer of the spec branch, and git makes a second writer
unrepresentable — inside one process. Nothing stopped a second afk process from starting on a spec
that already had one, and a second start force-removes and re-creates the gate worktree, which is
where the first one's fix agent may be working. It happened: run 1117 lost a correct repair to it.

**Decision: a run takes a lock on its run directory, and a second start against a live holder
refuses, naming the holder.**

- **The lock is a driven port** — acquire, release, holder — declared in the domain with its rules
  beside it. One adapter implements it as a file in the run directory naming the holder's pid,
  written exclusively so two starts racing for an absent lock cannot both win it.
- **A holder is live while its process exists.** A lock whose holder no longer exists is absent, so
  a crash, a kill or a second interrupt needs no cleanup before the next start. A run lets go of its
  lock when it ends, however it ended; a process that never got that far leaves a lock that reads as
  nobody's.
- **Every starting mode takes the lock, and so does starting over.** `--force-fresh` against a live
  run is the most destructive thing afk can do, so it asks first and throws nothing away if refused.
  A holder asking again already holds it: starting over and then starting are one process.
- **Drawing the board takes no lock and writes nothing**, so a second terminal can watch a live run
  (ADR-0030).
- **The holder is read before any other refusal.** A spec somebody is running is not a spec with the
  wrong flags, and telling the operator to pass `--resume` would send them after the wrong thing.

## Considered options

- **Rely on git refusing a second checkout.** Rejected: afk force-removes the gate worktree before
  checking it out again, so git's refusal is exactly what the second process steps around.
- **A lock outside the run directory.** Rejected: `.afk/` does not ignore itself, only each run
  directory does (ADR-0013), and the lock belongs with the run it guards — starting over takes it
  away with everything else.
- **Record the holder's children too.** Rejected: the holder's own shutdown already takes its
  children down (ADR-0016), and a pid registry on disk is one more thing to go stale.

## Consequences

- **A pid can be reused.** A lock naming a dead afk whose pid now belongs to something else reads as
  held. The refusal names the pid, which is enough for an operator to see it is not afk.
- **Taking over a live run is not part of this decision.** Off a terminal the refusal is flat; an
  interactive takeover builds on the port, and gets a decision of its own (ADR-0035).
