> **Consumed, not authoritative.** The decisions in this document now live in `docs/adr/` and
> its vocabulary in `CONTEXT.md`, which supersede it wherever they disagree. It is kept only
> until the spec it feeds has been split into tickets, and is then deleted. Do not implement
> from it.

# Handoff: --resume fails work that is already finished

Written 2026-09-14, across three `--resume` attempts on a live run of spec
[ADFERENCE/cortua#886](https://github.com/ADFERENCE/cortua/issues/886). Unlike `HANDOFF.md`, the
fixes here **are implemented** — uncommitted in `afk/main.ts` at the time of writing.

Five bugs, found one per attempt as each fix uncovered the next. **None of them is about the work
being wrong**; every one is the runner misreading finished work as failure. They are ordered as
they surfaced.

**Read alongside:** `HANDOFF.md` is the layerless redesign that deletes much of the code touched
here. This document is about the runner **as it is today**. All five are properties of the design,
not typos, so the *Carry into the layerless rewrite* section says what each one means for it.

## What happened

Spec #886 planned 3 layers / 6 tickets. Layer 2 (#892, #893, #894) all branch off #890 and all edit
`playbook-validation.ts`, the save action and the planner — sibling tickets with an unavoidable
overlap. #893 merged first. #892 and #894 then sat with finished, committed, verified work on
branches that were two commits behind the layer branch.

Every `--resume` after that marked both tickets `failed` and, on the last run, flipped layer 2 from
`verified` to `failed`. Neither had anything to do with the work being wrong.

## Bug 1 — proof of work was HEAD movement, not branch position

`implementOnce` measured a commit made *during this invocation*:

```ts
const before = rev-parse HEAD
await runAgent(...)
const after  = rev-parse HEAD
if (after === before) return "no-commit"     // ← fails here
const extra  = rev-list --count layer..HEAD  // ← the real proof, never reached
```

A resumed run hands the agent a ticket that is already committed. The agent inspects the tree, finds
nothing to do, and says so — correctly. #894's implementer, on its third identical wake-up:

> I won't manufacture a commit to satisfy a retry trigger.

HEAD does not move → `no-commit` → retry (`retryStrategyFor` always resumes) → `no-commit` →
`failed`. The check that would have passed — commits ahead of the layer branch — sat three lines
below the early return.

**Fix:** delete `before`/`after`; judge by `extra` (ahead) and `behind`. `extra === 0` is
`no-commit`, `behind !== 0` is `changed-base`, otherwise success. An idempotent agent is now the
expected case rather than a failure.

## Bug 2 — a leaked scratch worktree fails the whole layer

`verifyLayer` did `git worktree add` with no guard, unlike `implementOnce`, which has
`if (!existsSync(entry.worktree))`. A previous run had died before its `worktree remove`, so
`.afk/886/wt/verify-layer-2` still existed and was still registered. `git worktree add` refuses an
existing path → `return false` → layer marked `failed`.

The tell: the verify agent never ran, so `layer-2.verify.json` still read `ok: true` from the
previous run and `layer-2.log` had not moved. **A layer verdict that predates the failure is the
signature of this bug.**

`resolve-t*` and `pr-layer-*` had the same latent hole; only the verify one leaked.

**Fix:** a `freshWorktree(ctx, worktree, branch)` helper used by all three throwaway sites. It
**removes and re-adds** rather than reusing — a leftover may sit on a commit the branch has since
moved past, and verifying that is worse than failing. The per-ticket worktrees are deliberately
long-lived and do not go through it.

## Bug 3 — the resolver wanted a second checkout of a branch already checked out

Surfaced on the run after bugs 1–2 were fixed:

```
#894 conflicted — resolving
could not create .afk/886/wt/resolve-t894: fatal: '<ticket branch>' is already
used by worktree at '.afk/886/wt/t894'
#894 left open — conflict unresolved
```

`resolveConflict` built a scratch `resolve-t<n>` worktree on the ticket's branch. Git will not check
one branch out in two worktrees, and the ticket's own worktree holds that branch for the life of the
run — so this path could **never** work. `freshWorktree` does not help: it clears a colliding
*path*, and this is a colliding *branch*.

**Fix:** resolve in the ticket's own worktree. It already has the branch, and it is the installed,
warm one — so the resolver can run the repo's checks on what it merged instead of resolving blind in
a bare checkout, which is what a fresh worktree would have given it. Guarded by a
`git status --porcelain` check first, since merging into a dirty tree buries the conflict and the
rollback would discard the uncommitted work with it.

## Bug 4 — `--session-id` is wrong on every resumed run

Same log, two lines that cost an agent call each:

```
#892 crashed — retrying (resume)
#894 crashed — retrying (resume)
```

Both "crashes" were instant, and `t892.log` has the reason: `Session ID … is already in use.`
`implement` always made its first attempt with `resume = false`, and `runAgent` turns that into
`--session-id <id>` — which refuses an id that exists, exactly as `--resume` refuses one that does
not. Every resumed run therefore burned one agent invocation per ticket discovering this, then
retried into the right answer.

**Fix:** a ticket past `pending` has been attempted, so its session exists — the first attempt
resumes and the **retry flips the guess**, so being wrong costs one attempt rather than the ticket.
That also covers the opposite case, a run that died between `setStatus("implementing")` and the
agent starting. `retryStrategyFor` is gone; it encoded a choice that was never free.

## Bug 5 — a silent fetch left the local layer branch stale

After #892 merged, `state.json` said `merged` and GitHub had the squash, but local
`afk886/layers/2` still pointed at the pre-merge commit. `mergeTicket` does

```ts
await mutate(ctx, "git", [..., "fetch", "origin", `${layer.branch}:${layer.branch}`])
```

and never reads the result. Git refuses to fast-forward a branch some worktree has checked out —
the leftover verify worktree from bug 2 was holding it — so the fetch failed silently. Every later
`behind` count against that branch is then wrong, which is bug 1's failure mode arriving by another
road.

**Fix, two parts:** log when that fetch fails, and `sweepScratchWorktrees` at run start removes
every `verify-*` / `pr-*` / `resolve-*` leftover before anything else runs. `freshWorktree` clears
one as it is next *needed*, which is too late — the damage happens while it is still sitting there.
The per-ticket `t<n>` worktrees are deliberately long-lived and never swept.

## Not fixed: `changed-base` has no rebase path

`implementOnce` detects that a ticket is behind its layer branch and fails it. Nothing rebases. The
conflict resolver the runner already owns lives in `mergeTicket`, which a failed implement never
reaches — so a sibling-overlap conflict is diagnosed and then dropped on the floor.

On #886 this meant a human rebased both stragglers by hand and resolved the same overlaps the
resolver agent was built for — #892 onto the layer tip, then #894, each re-verified (typecheck
14/14, tests 16/16). #892 then merged as `b83fb2b5`. Because both had been rebased onto the *same*
tip they still conflict with each other, which is correct and is what bug 3 was blocking: #894's
conflict is the resolver's job, not a human's.

**The layerless design already fixes this** — tickets merge into the spec branch through
`merge-tree` + resolver, so "behind the branch" is the normal case, not a failure state. Worth not
patching here if the rewrite is close.

## Verifying the fixes

`afk/main.ts` is type-stripped at runtime with no build, and the repo's `typecheck` script only
covers `apps/backoffice`. What was run:

```
node --experimental-strip-types --check afk/main.ts
npx biome check afk/main.ts
```

Both clean. No test suite exists for the runner — see *Open* below.

## Carry into the layerless rewrite

All five are design properties, and each has a place in the new design:

- **Bug 1 → `state.json` is intent, the branch log is truth.** `HANDOFF.md` already says resume
  re-runs the gate for anything at `merged`, cross-checked by
  `git log --grep 'afk-ticket: <spec>/<n>'`. That is the correct generalisation of this fix: never
  ask "did the agent just commit", always ask "is the work on the branch". Make sure no step
  regresses to measuring an invocation.
- **Bugs 2, 3 and 5 are one bug wearing three hats: a worktree outliving the step that made it.**
  The new design's **one long-lived gate worktree** (`reset --hard` + setup + verify) removes the
  leak for the gate, which is most of it. What must survive the rewrite: the resolver runs in the
  **ticket's** worktree (bug 3 is not a leak but a branch that can only be checked out once — it
  will recur verbatim if the resolver ever gets its own worktree again), and **no git result that
  moves a branch may go unchecked** (bug 5).
- **Bug 4 → session identity belongs in state, not in a guess.** The runner knows whether it
  created a session; it just never wrote it down and inferred it from the wrong thing. If
  `TicketState` gains an `attempts` or `sessionStarted` field in the rewrite, this disappears
  rather than being re-derived.

## Suggested skills for the next session

Call the Skill tool for:

- **`mattpocock-skills:code-review`** — review the uncommitted `afk/main.ts` diff before it is
  committed. Two axes: does it match this document, and does `freshWorktree` belong where it was put.
- **`mattpocock-skills:tdd`** — if the runner is to grow tests rather than be rewritten. The two
  regressions here are cheap to pin: a ticket whose work is already committed must implement clean,
  and a step whose scratch worktree already exists must still run.
- **`mattpocock-skills:domain-modeling`** — only if folding this into the rewrite. *Proof of work*
  is the term that was missing and that both bugs turn on.

## Open

- **The fixes are uncommitted.** `git diff afk/main.ts` in this repo, ~114 insertions / 28
  deletions over `57f2c5d`.
- **The runner has no tests**, so every fix here is argued from reading, `node --check` and a lint
  pass. Bugs 1 and 2 have survived a real `--resume`; bugs 3, 4 and 5 have not yet been exercised.
- **Whether `no-commit` deserves a retry at all** is untouched. With bug 1 fixed it is a genuine
  signal rather than noise, so the retry may now be pure waste.
- **Each fix so far has uncovered the next.** Nothing suggests bug 5 is the last one; the pattern is
  that the first resumed run of any spec finds them, and only a resumed run does.
