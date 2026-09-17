---
status: accepted
---

# The spec branch is cut from local trunk, and the preflight tells rather than refuses

The superseded runner's preflight did two things before anything ran: it refused unless the
`gh-stack` extension was installed, and it fetched `origin/<trunk>` and refused unless the local
trunk and the remote one were the same commit — *pull before starting* when behind, *push before
starting* when ahead, because "the remote trunk must contain the base or the root PR's diff is
meaningless".

Both reasons are gone. There is no stack and no root pull request (ADR-0007), so no extension to
check for; and merging is entirely local, so the base a ticket is built on is a commit on this
machine rather than something GitHub has to already know about.

**Decision: the spec branch is cut from the operator's local trunk, and the preflight refuses
nothing about the state of that trunk.** afk never pulls, never moves trunk, and never touches the
working tree.

What runs before a run instead:

| step | on failure |
| --- | --- |
| resolve the target repository from the invoking directory's git top level | refuse: afk has no repository to work on |
| find trunk — what `origin/HEAD` names, else `main`, else `master`, and in every case a branch this checkout actually has | refuse: afk has nothing to cut from |
| fetch the remote trunk and compare the local one against `FETCH_HEAD` | no remote to compare with: a note |
| read whether the working tree is dirty | a warning |

The fetch is the only thing that reaches the network and it moves nothing the operator can see: it
writes `FETCH_HEAD`, which is what the comparison reads, and leaves the local trunk, the index and
the working tree exactly where they were.

Ahead is a **note**, behind and dirty are **warnings**, and all three are shown at the top of the one
confirmation screen (ADR-0014) rather than asked about separately. Under `--implement-only` they
print and the run proceeds: the mode that does not ask is still the mode that tells.

## Considered options

- **Keep refusing when trunk is behind.** Rejected. It forces a stash and a pull before afk can be
  started at all, and what it protects against — a stale base — is the operator's own call to make
  now that the base never leaves the machine.
- **Fetch and fast-forward the local trunk.** Rejected outright: moving a branch the operator did not
  ask to have moved, in a working tree they left open, is the opposite of what an unattended tool
  should do.
- **Cut the spec branch from `FETCH_HEAD` rather than from local trunk.** Rejected. A refactor or an
  ADR committed locally before starting would then be invisible to every implementer and to the code
  review that follows, which is the case this decision exists to serve.

## Consequences

- **An unpushed commit on trunk is part of the run by design.** The spec PR is opened against the
  repository's default branch, so a commit the operator never pushes will appear in that pull
  request's diff. The note says so at the point where it can still be acted on.
- **Uncommitted changes are not part of the run**, and cannot become part of it: an implementer works
  in its own worktree cut from a commit.
- **A repository with no remote works.** Nothing is compared, the run says so, and it proceeds —
  which is also what makes the git adapter testable against a throwaway repository.
- The two refusals that remain are about the repository being usable at all, not about its state, so
  neither can be fixed by afk doing something to the operator's branches.
