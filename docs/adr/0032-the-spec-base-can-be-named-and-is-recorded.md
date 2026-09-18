---
status: accepted
---

# The spec base can be named, and is recorded in the manifest

ADR-0018 decided that a spec branch is cut from local trunk — what `origin/HEAD` names, else `main`
— and that afk resolves this fresh on every invocation. Trunk is not stored anywhere, because it is
re-derivable from the repository at any time.

That holds only while every run wants trunk. A spec whose work belongs on a long-lived release or
integration branch has no way to say so, and the workaround — checking that branch out as trunk —
is not one, because afk reads `origin/HEAD` rather than `HEAD`.

**Decision: `--branch <name>` names the branch a spec is based on, and the manifest records it.**

The flag is decided once, when the spec is planned, and the resolved name is written into the
manifest beside the tickets. Every later read — the gate worktree's start point, the merge track's
trailer cross-check, the pull request's base — takes it from there, so a resumed run cannot drift
onto a different base than the one its spec branch was actually cut from.

| | |
| --- | --- |
| `--branch <name>` given | that branch, which must already exist locally |
| no flag | what `origin/HEAD` names, if this checkout has that branch |
| neither | `main` |
| manifest written before this decision | `main` |

The flag is refused where it cannot be honoured: a name with no local branch behind it, and a name
already recorded differently in the manifest. Under `--implement-only` and `--board-only` it is
warned about and ignored, because neither plans.

## Considered options

- **Accept a remote branch, `--branch origin/main`, fetching it first.** Rejected. It is the
  `FETCH_HEAD` option ADR-0018 already turned down, re-entered through a flag: a base afk fetched
  is a base the operator never saw, and the local commits ADR-0018 exists to keep visible would
  disappear from it. An operator who wants a remote branch can `git fetch && git checkout -b` it,
  which takes one command and leaves them looking at what they got. The `origin/` prefix is
  therefore refused with that instruction rather than silently resolved.
- **Resolve the base fresh on every invocation, as trunk was.** Rejected. It was sound while the
  answer was derivable from the repository; a flag makes it an operator's decision, and a decision
  that is not recorded is one a resumed run gets wrong. The spec branch already exists by then, so
  re-resolving cannot re-cut it — it would only move the pull request's base and the cross-check
  range away from where the branch actually came from.
- **Keep the base out of the manifest, in a file of afk's own.** Rejected. The manifest is already
  the whole contract a run reads, and a second file next to it is a second thing to keep in step.
  The planner is an agent, so what it returns is a claim (ADR-0003) — but afk writes the base over
  whatever the planner offered, which makes the field afk's own statement in a file the planner
  merely started.

## Consequences

- **The manifest is no longer derivable from the spec alone.** It carries one fact about the
  operator's invocation. `--force-fresh` re-plans and so rewrites it, which is the only way to move
  a run onto a different base.
- **`master` stops being a fallback.** The resolution order was `origin/HEAD`, `main`, `master`;
  it is now `origin/HEAD`, `main`. A repository whose default branch is `master` and whose
  `origin/HEAD` is unset must pass `--branch master` — one flag, against a fallback that was
  guessing anyway.
- **The preflight is unchanged in shape.** It still fetches `origin/<base>` read-only and reports
  ahead, behind and dirty as notices. A base with no matching remote branch falls to the "nothing to
  compare with" note that already existed.
