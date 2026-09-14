> **Consumed, not authoritative.** The decisions in this document now live in `docs/adr/` and
> its vocabulary in `CONTEXT.md`, which supersede it wherever they disagree. It is kept only
> until the spec it feeds has been split into tickets, and is then deleted. Do not implement
> from it.

# Handoff: afk goes layerless

Written at the end of a grilling session (2026-09-14). Nothing in it has been implemented. It
travels with this directory when afk moves to its own repository.

**Read first:** `afk/README.md` documents the runner **as it is today** — layered. This document is
the design that replaces it. Where the two disagree, this one wins; the README is a rewrite
deliverable, not a reference.

## Why

Spec [#66](https://github.com/romanlamsal/lamsal-dev-backoffice/issues/66) was specced into eight
tickets whose dependency edges give three layers of 4 / 2 / 2. The session started as "how do I make
a thin layer cheaper" — a 1-ticket layer pays for a whole-layer verification agent and a whole-layer
PR-prose agent to wrap a single commit that was already verified in isolation — and ended at "layers
should not exist".

Every job a layer does is done better by something finer:

| layer's job | replacement |
| --- | --- |
| parallelism batch | frontier poll per free implementer slot |
| integrity gate | a check behind the merge queue — a red result names the merge that caused it, not eight suspects |
| PR / review unit | one spec PR whose commits are the tickets |
| halt on a broken base | halt on a red spec branch, same property, finer grain |

A fact that reframed it: **trunk gets one squash commit per layer today**, not per ticket. `dcdb8fe`
is all eight of spec #44's layer-1 tickets as one commit. The per-implementer granularity is wanted
*during* the run, on the spec branch; trunk granularity is explicitly not cared about.

## Decisions

Ten decisions this design rests on. Each is hard to reverse, surprising without the context that
produced it, and the result of a real trade-off — so each is an ADR candidate in the new repository,
and none should be re-litigated by an implementer who only read *The design*.

1. **`/to-tickets` output is taken as-is.** Neither the planner nor the runner second-guesses ticket
   granularity, scope or overlap. Spec #886 failed with three sibling tickets all extending the same
   enum and hooking the same save action — and the obvious fix, teaching the runner to detect or
   serialise overlapping work, is refused. Ticket shape is the ticketing skill's problem; the runner
   owns execution and must survive whatever it is handed.

2. **Base reconciliation belongs to the merge track, never the implementer.** An implementer asserts
   only that it produced commits on the base it was given, without moving that base. Whether the
   spec branch has advanced since is not its business and is not a failure. This is the #886 bug
   stated as a rule: the layered runner conflated *"you built on the wrong base"* with *"the branch
   moved under you"* in one condition, and the second is true of every sibling that is not first to
   merge.

3. **Every ticket is rebased onto the tip unconditionally.** No conflict probe picks between a fast
   path and a slow one. One path that always runs is one path that is always exercised — the layered
   runner's rare paths are where its bugs lived.

4. **Recovery is resume-only.** Mid-run, a ticket that cannot land is skipped along with its
   dependents and the frontier carries on. Nothing diagnoses, retries cleverly or waits for a human
   while the run is unattended. Repair happens on the next `--resume`, when someone is watching.

5. **Ticket status is derived, never stored.** `state.json` holds an append-only log of lifecycle
   events; status is the last event. Two representations of one fact is how the layered runner's
   state and GitHub came to disagree.

6. **The gate worktree owns the spec branch.** One worktree, one writer, no ref juggling. Git
   refuses to check a branch out twice; this makes that failure unrepresentable rather than guarded
   against.

7. **The merge track is serial as a correctness precondition, not a performance choice.** Because
   one writer owns the spec branch and nothing can land between a ticket's rebase and its merge,
   that merge cannot conflict. Parallelising the merge track would silently reintroduce conflicts at
   a step that no longer handles them.

8. **`.afk/` is machine-local and deliberately not portable.** State, worktrees, attempts and logs
   live on one laptop and are never expected anywhere else. Anything a second reader needs must
   reach the spec branch's commits, or it does not exist.

9. **Trunk granularity is not cared about.** Per-ticket granularity is wanted *during* the run, on
   the spec branch. Trunk gets one squash commit per spec.

10. **A dependent already in flight when its blocker is reverted is allowed to finish, then
    skipped.** Layers made this impossible; frontier scheduling makes it routine. Throughput bought
    at the price of wasted work — decided, not discovered.

## The design

### Plan

The planner reads the spec's sub-issues, recovers `blockedBy` from each body's prose `## Blocked by`
section, and emits a **flat DAG** — no layers. It additionally derives two commands for this
repository: `setup` (install/prepare) and `verify` (what proves integrity).

`Layer` leaves the manifest schema. Roughly:

```ts
{ spec, trunk, branch, setup, verify, tickets: [{ number, title, branch, blockedBy }] }
```

### Confirm (interactive)

Between the planner and the first implementer, an interactive step shows `setup` and `verify` for
editing. Both are arbitrary planner-authored strings that will run on the user's machine; the
confirmation is the only thing standing between them and execution. The DAG is **not** edited here —
the planner is trusted to map tickets from GitHub issues correctly.

**No TTY and no `--plan`/`--implement` → exit non-zero naming both flags.** Never auto-continue: a
mode that skips the confirmation when nobody is watching is the mode that runs the wrong command
unsupervised.

### Branch names

```
spec     afk/<spec>/spec
ticket   afk/<spec>/t<n>
```

The `/spec` segment is not decoration: git cannot hold `refs/heads/afk/66` and
`refs/heads/afk/66/t67` at once. Same trap the old layer names documented.

### Implement

A rolling pool of `--max-parallel`. Each free slot takes from the **frontier** — tickets whose every
blocker has verified — ordered **most-dependents-first**, tie-broken by manifest order. Starting a
blocker late stalls the pool: on #66, a late #70 blocks #72, #73 and #74.

On start, the ticket is assigned to the invoking user (`gh issue edit <n> --add-assignee @me`).
It is **never unassigned** — an unassigned ticket looks unattempted, and an attempted-and-failed one
is exactly what you want to find later.

Implementer constraints are unchanged from the README: commit only, never rebase, merge, pull or
reset onto anything.

What is checked afterwards is **two separate assertions**, and conflating them is the #886 bug. The
worktree's base is recorded as `baseSha` when it is cut, and afterwards:

- **did it build on that base** — `git merge-base --is-ancestor <baseSha> HEAD`;
- **did it produce anything** — `<baseSha>..HEAD` is non-empty.

**Being behind the spec branch is neither checked nor a failure.** With a rolling pool it is the
normal state of every ticket that is not first to merge. The layered runner tested
`rev-list HEAD..<branch> == 0` alongside those two, so one sibling merging first failed its
neighbours mechanically — finished, green work sitting in their worktrees that the merge track,
whose conflict resolver was built for exactly this, never saw.

`baseSha` is also what the gate's skip compares against, so it earns its place twice.

### Merge — entirely local, no ticket PRs

Serial, single-writer, one ticket at a time:

```
skip?    → blocker reverted while this was in flight → skip, do not rebase
rebase   → git rebase <spec-branch>, in the ticket's own worktree
           conflict → /mattpocock-skills:resolving-merge-conflicts → --continue
merge    → git merge --squash <ticket-branch>, in the gate worktree
gate     → setup && verify
```

Dropping ticket PRs deletes `gh pr create` per ticket, the `mergeable` poll, **and the whole
eventual-consistency retry loop** — whose own justification in the README is "every merge error
observed so far was a race". Races are a property of merging through GitHub's API; a local merge on
a single-writer branch has none.

**The skip is checked first**, before the rebase. A ticket whose blocker was reverted is about to be
discarded, so spending a resolver call on its conflicts is pure waste.

**The rebase runs in the ticket's own worktree.** That worktree already holds the branch — git will
not check one branch out in two worktrees, so a resolver with a worktree of its own is a path that
can never work — and it is the warm, installed one, so the resolving agent can run the repo's own
checks on what it produced instead of resolving blind. The tree must be clean
(`git status --porcelain`) before it starts: rebasing over uncommitted work buries it.

**The skill never aborts; the script does** — on a non-zero exit, or on a tree still conflicted
after the agent exits. That split is unchanged from the layered runner.

**The merge cannot conflict.** The rebase has already placed the ticket's commits on the current
tip, and the merge track is serial and the sole writer to the spec branch, so nothing can land in
between. That is why `git merge-tree` probing is deleted rather than kept as a fast path: after the
rebase there is nothing left to probe.

The squash body is `git log --format=%B <tip-before>..<ticket-branch>` — the implementer's own
commit messages, which is what GitHub was concatenating anyway — plus the resolving agent's note
where there was a conflict, and the trailer:

```
afk-ticket: <spec>/<n>
```

There is **no** `afk-conflict:` trailer. A trailer is for a machine; the only machine that would
grep it is this runner, and the runner already has the event log. The resolution's *prose* stays,
because a spec-PR reviewer has no other way to learn that an agent made an unreviewed judgement call
inside that commit — which is this design's live risk, not a hypothetical one.

#### When the rebase cannot land

The resolving agent exits non-zero, or leaves the tree still conflicted:

- `git rebase --abort` — branch and worktree return to the pre-rebase commit, tree clean;
- ticket `failed`, dependents `skipped` transitively;
- **the spec branch is untouched**: no revert, no gate re-run. The nothing-landed case is cheaper
  than the gate-red case and stays visibly so.

The branch, the worktree and the log are kept. That is what makes the ticket recoverable afterwards,
and it is exactly what a human did by hand to rescue #886.

### Gate

Sits behind the merge, in the **one long-lived worktree that owns the spec branch**
(*Decisions* 6). Created at run start and reused across every merge — `setup`, then `verify`. A
fresh worktree per merge would mean re-installing a 454 MB `node_modules` each time, and that cost
is what decides whether a serial merge-and-gate track is viable at all.

On `--resume` the worktree is **re-created rather than reused**: a killed run can leave it dirty,
mid-`verify`, or holding a half-applied merge, and proving it is safe is worse than paying the
reinstall. Note the granularity — once per resumed run, not once per merge. The reuse that makes the
track viable is untouched.

`setup` runs **unconditionally** before every gate rather than being triggered by a lockfile change.
That deletes the mechanism instead of generalising it, and keeps the runner package-manager agnostic
— no hardcoded `pnpm-lock.yaml`, consistent with afk's "no repo-specific config" rule.

The gate can be skipped **only when `spec tip == baseSha`** — that is, when the rebase was a no-op
and the merge produced the very tree the implementer already verified. Anything else means a tree
nobody has ever run `verify` against. The layered design stated this more loosely ("only if the spec
branch moved"); unconditional rebasing narrows it to the one genuinely free case — the first ticket
in, or one that finished while nothing else landed.

On red:

1. one fix-agent attempt — hard constraint unchanged: fix the cause, never the signal;
2. still red → `git revert` the merge, ticket `failed`, dependents skipped transitively;
3. **re-run the gate on the reverted tip.** Green confirms the ticket was the cause. **Red → halt**:
   the branch is broken independently of any ticket and nothing above it is trustworthy.

Step 3 is what makes the localisation claim true rather than asserted. Without it the runner would
revert every ticket in turn against a branch that was already broken.

`git revert` and not `reset --hard` + force-push: append-only is the only thing compatible with a
rolling pool holding worktrees off the tip. The revert pair vanishes in the final squash anyway.

### The new hazard, accepted knowingly

**A dependent can already be in flight when its blocker is reverted.** Layers made this impossible —
nothing could start until the layer below verified. Frontier scheduling makes it routine.

Resolution: **let it finish, then skip it at the merge** — checked as the merge track's first act on
the ticket, before the rebase, so no resolver call is spent on work about to be discarded. The
expensive half is already paid; merging is the one thing that must not happen, because it built on a
tree that no longer exists upstream. Its branch and log stay for reading.

This is the barrier's value, traded for throughput. It was decided, not discovered.

### Finish

One agent call writes the spec PR's title and summary over the finished branch; the **script**
appends one `Closes #<n>` per *verified* ticket, composed from state. Created at the end, not as a
draft at the start. **Squash-merged** to trunk.

## Flags

Orthogonal, each asserting exactly one thing about the filesystem:

| flag | meaning |
| --- | --- |
| *(none)* | plan → interactive confirm → implement |
| `--plan` | run the planner, write `manifest.json`, exit |
| `--implement` | `manifest.json` required; **refuses an existing `state.json`**, naming `--resume` and `--force-fresh` |
| `--resume` | `state.json` required (which implies a manifest) |
| `--dry-run` | requires `--implement`; **creates nothing locally**, stdout only |
| `--force-fresh` | delete `afk/<spec>/*` local and remote, close the spec PR if one exists, clear `.afk/<spec>/`; **assignees untouched**; no confirmation prompt — the flag is the consent |

`--dry-run` today runs the real planner and writes to disk, because `runAgent`/`planManifest` ignore
`ctx.dryRun` and `mkdirSync`/`writeFileSync`/`saveState` bypass the `mutate` guard. Three writes to
route through the flag, plus the `--implement` requirement so it stops burning a planner call to
simulate nothing.

## State and truth

`state.json` holds, per ticket, an **append-only log of lifecycle events**:

```ts
{ step, outcome, at, detail, log }
```

`step` is closed — `implement → rebase → resolve → merge → gate`, plus `revert` when the gate goes
red. `outcome` is `ok | failed | skipped`. `detail` is free text and `log` points at the agent
transcript; neither is ever branched on. **Status is the last event, derived. It is not stored.**

There is deliberately **no closed enum of failure reasons**. A laptop that slept, a connection that
dropped, a rebase that would not land and a gate that went red are not usefully the same shape, and
guessing the set before hitting it is how folklore starts. The **step** is what recovery keys on.

Resume reads the log and dispatches:

| last event | resume does |
| --- | --- |
| `implement:ok`, no `rebase` | enter the merge track |
| `implement:failed` | resume the implementer's session; failing that, the prepare agent |
| `rebase:failed` / `resolve:failed` | the prepare agent |
| `merge:ok`, no `gate` | re-run the gate — closes the crash window between the squash and the write |
| `gate:failed`, no `revert` | revert, then re-gate |

The README's current rule — *"GitHub is the truth for what landed"* — is dead, because dropping
ticket PRs leaves GitHub nothing to be asked. Replacement:

- **The event log is the record of what was attempted and how far it got**, and it is what resume
  dispatches on.
- **The spec branch's log is the cross-check for what landed**:
  `git log --grep 'afk-ticket: <spec>/<n>'`. A git fact, not a GitHub one, checkable from a fresh
  clone with no state file. It is a *cross-check* and not the dispatcher: a commit says a ticket
  landed, never which step failed or why.

`.afk/` — state, worktrees, attempts, logs — is **machine-local by design and deliberately not
portable**. That constraint is load-bearing, not incidental.

## The prepare agent

A fifth agent role, alongside the implementer, the conflict resolver, the gate's fix agent and the
PR writer. It exists because a resumed run starts from wreckage, and wreckage is judgement, not
mechanics.

- **It runs only on `--resume`.** Never mid-run — mid-run the answer is skip and carry on
  (*Decisions*, 4). Keeping it off the unattended path keeps the unattended path free of a new
  failure mode.
- **It only ever prepares.** It never merges, never lands work, never touches the spec branch. It
  leaves the ticket in a state the normal track can pick up, and hands back.
- **Its instruction varies by the step that broke.** A ticket stuck at `rebase:failed` needs
  something different looked at than one stuck at `implement:failed`. The agent is broad by design,
  because it is the out-of-the-ordinary path — but it is never invoked without being told what to
  check for.

The contents of those per-step instructions are **out of scope for this document** and are a ticket
of their own.

## What reaches GitHub

Exactly twice:

1. `--add-assignee @me` when a ticket's implementer starts.
2. The spec PR at the end.

No progress comments, no labels, **and no conflict-resolution note on the ticket issue.** A comment
pointing at a resolution that only exists in `.afk/` on one laptop is worse than no comment. The
resolution lives in the ticket's squash commit body.

## Deleted

`gh-stack` and its preflight check · layer branches and the `…/layers/<n>` naming workaround ·
`Layer` from the schema · `verifyLayer` per layer · the layer-PR prose agent · ticket PRs ·
`mergeable` polling · the merge retry/backoff loop · the `git merge-tree` conflict probe · the
implementer's "is the branch behind" check · the stored `status` enum · the conflict resolution as a
commit of its own.

## How it lands

**Move afk to its own repository first**, then spec it there.

The objection to speccing it in `lamsal-dev-backoffice` is real: an implementer there reads
`CONTEXT.md`, `docs/agents/layers.md` and the Offer domain, and afk is none of those. Moving is what
makes the domain right, so it comes first rather than after. afk is four files with no dependencies
and its README already says to copy the directory into any repo; the backoffice vendors a copy.

**The intended way to consume this document is `/grill-with-docs` → `/to-spec` → `/to-tickets`.**
Period. It does not tell any of them how to do their job, and it deliberately sketches **no ticket
spine** — ticket shape is theirs (*Decisions*, 1). The layered afk's last job is planning the
tickets for its own replacement.

The vocabulary the new repo has to carry, because it currently lives only in this prose: *spec*,
*ticket*, *frontier*, *the spec branch*, *baseSha*, *the gate*, *the prepare agent*, *the lifecycle
event log*, `verified` vs `merged`, *setup* / *verify*. Layers are gone and none of it may mention
them.

## Open, carried deliberately

- **`verify` is an arbitrary planner-authored string that runs on the user's machine.** The
  interactive confirmation is the only thing between it and execution. An earlier proposal — have
  preflight run it on a clean trunk to prove it works — was rejected outright: running a discovered
  command to check it is arbitrary code execution, not a safety check. Accepted risk, not a solved
  problem.
- **The fix agent gets one attempt** before the revert. Settled by implication, never stated
  outright; worth making explicit in the spec.
- **Merge-track throughput is untested.** A serial merge-plus-gate track against three parallel
  implementers. The gate skip is the pressure valve, unconditional rebasing has narrowed it to
  `spec tip == baseSha`, and nobody has measured it.
- **Not for the immediate consumer — a deferred optimisation.** The merge track could probe every
  implemented-but-unmerged ticket up front and take the conflict-free ones first, putting cheap
  merges ahead of expensive ones. It is the one surviving use for `git merge-tree` after this design
  deletes it as a gate. Recorded so the next session neither re-derives it nor re-adds it as a
  conflict gate — **it is not part of the rewrite and should not be specced.**
