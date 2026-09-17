---
status: accepted
---

# The gate is one long-lived worktree and runs unconditionally

After each merge the spec branch has to be proven sound. The check is `setup` then `verify`, and
what it asserts is the integrity of *everything merged so far* — not that one implementer made no
mistake. That distinction is the reason it exists: every other check can be green while the branch
is broken. Two tickets with no textual overlap, each verified in isolation, once failed to compile
together because one moved a type the other had just imported.

**Decision: one gate worktree, created at process start and reused across every merge. `setup` runs
unconditionally before every gate. The gate runs after every merge, without exception. The worktree
is re-created at every process start rather than reused across processes.**

## Considered options

- **A fresh worktree per merge.** Rejected. Re-installing dependencies on every merge is what
  decides whether a serial merge-and-gate track is viable at all.
- **Trigger `setup` from a lockfile change.** Rejected. It hardcodes one package manager's filename;
  running `setup` every time deletes the mechanism instead of generalising it.
- **Skip the gate when the rebase was a no-op**, on the grounds that the implementer already
  verified that exact tree. Rejected. A self-verify is an implementer's own report (ADR-0015) and is
  not what `verified` means; the exception buys one skipped `verify` on the ticket that needs it
  least, and pays for it with a status that nothing actually checked.

## Consequences

- Re-creation is **once per process start, not once per merge** — the reuse that makes the track
  viable is untouched. It is keyed on the process rather than on resume because resume is not a code
  path (ADR-0019): every start re-creates it, and the run that most needs it is simply the one that
  follows a kill. A killed run can leave that worktree dirty, mid-`verify`, or holding a half-applied
  merge, and proving it safe is worse than paying the reinstall.
- Every merged tree is verified, so `verified` means exactly one thing everywhere it is used: the
  slate's blocker test, and the spec PR's `Closes` lines.
