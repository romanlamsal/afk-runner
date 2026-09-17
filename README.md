# afk

Runs a whole spec's tickets unattended.

afk plans a flat DAG from a spec issue's tickets, implements the ready ones in parallel, squashes
each onto one spec branch, proves that branch after every single merge, and opens one pull request
at the end. Everything but the claim and that pull request happens on your machine.

## Requirements

- **Node 24+**, which strips types itself: afk is TypeScript run directly, with no build step and
  nothing to bundle. `tsx` works too; nothing else is promised.
- **`gh`** on `PATH`. It is how afk reads the tracker and how it writes to it.
- **`claude`** on `PATH`. Every agent role goes through it.
- afk's own dependencies: `npm install` once, in afk's clone.

## Invocation

afk is cloned once and run against any repository. The target repository is the git top level of
the directory you invoke it from — afk refuses to start outside a git worktree, and it is never
copied into the repository it works on.

```
cd ~/code/the-repository
node ~/code/afk/src/main.ts 42
```

`package.json` declares an `afk` bin, so `npm link` or a shell alias gets you:

```
afk <spec> [--plan-only | --implement-only] [--resume] [--force-fresh] [--max-parallel <n>]
```

| invocation | |
| --- | --- |
| bare | plan, confirm, implement. Refuses when a manifest or a run already exists, naming the flag to use |
| `--plan-only` | plan the spec, write the manifest, print the execution order, exit |
| `--implement-only` | implement an existing manifest without planning again. Refuses an existing run unless `--resume` consents |
| `--resume` | consent to continuing an existing run. It changes no behaviour — a resumed run is the ordinary loop against a log that is not empty |
| `--force-fresh` | delete this spec's branches local and remote, its run directory and its pull request, then start over. No prompt: the flag is the consent |
| `--max-parallel <n>` | implementer slots, default 3 |

`--plan-only` and `--implement-only` name different halves of a run and cannot be combined; neither
can `--force-fresh` and `--implement-only`, because starting over deletes the manifest the second
one requires. Either pair exits `2`.

A bare invocation needs a terminal: with nobody there to answer the confirmation, afk refuses rather
than continuing unsupervised. With no TTY, pass `--plan-only` or `--implement-only`.

## What a run does

1. **Plan.** An agent reads the repository's own documentation to work out which issues are the
   spec's tickets, how they block each other, and what this repository's `setup` and `verify`
   commands are. The result is the manifest.
2. **Confirm.** One screen, one decision: anything worth knowing about your trunk and working tree,
   then `setup` and then `verify`, pre-filled and editable in place. Empty input keeps the proposal.
3. **Cut the spec branch.** `afk/<spec>/spec`, from your *local* trunk, into the gate worktree —
   the one long-lived worktree that holds it and its only writer.
4. **Set up, then implement.** A rolling pool of slots draws from the slate: the tickets whose every
   blocker is verified, most-dependents-first. Setting one up claims it, cuts it its own worktree on
   `afk/<spec>/t<n>`, copies the repository's ignored environment files in and runs `setup` there —
   a step of its own, so a run killed during it is visible and costs the ticket an attempt. A setup
   that broke or was killed is never repaired: the worktree is thrown away and cut again, and that
   recut is the ticket's second and last setup. The implementer then works in the worktree its setup
   cut, on its own budget of two attempts, and runs `verify` on its own work before reporting back.
5. **Merge, serially.** One ticket at a time, and three steps of its own: rebase onto the spec
   branch's tip; where git stopped on a conflict, resolve it in the ticket's own worktree; squash
   into the spec branch. A run killed between any two of them resumes at the next one. A ticket gets
   two trips through the track — a resolve that could not land spends the rebase's budget rather
   than one of its own, because it is the same trip.
6. **Gate.** `setup` then `verify` on the spec branch, after every merge — so a red result names
   one merge. Green is the only thing that makes a ticket **verified**. Red buys one fix attempt, a
   step of its own with a budget of one, constrained to fix the cause and never the signal. What the
   fix agent says is not the answer: the gate runs again over what it left behind, so a fix that was
   killed costs its budget and goes back to the gate rather than buying a second one. Still red and
   the merge is reverted, the ticket failed, its dependents skipped, and the reverted tip gated
   again. Red there halts the run.
7. **Finish.** Push the spec branch and open one pull request against the default branch: ready
   when every ticket verified, a draft naming what is missing when not, and none at all when
   nothing was verified. afk opens it and stops — merging it is yours.

Every external invocation — agent, `setup`, `verify` — times out after an hour, and a timeout is an
ordinary failure.

**What a broken step is worth.** Five steps get a prepare pass — an agent sent to the wreckage with
the broken step named — and one more attempt after it: `implement`, `rebase`, `resolve`, `merge` and
`gate`. The other four get none, each for its own reason. A broken `setup` is recut, because
throwing a half-made worktree away is faster and more certain than anything an agent would do to it.
A broken or killed `fix` goes back to the gate, because the branch decides whether the fix worked
and not the agent's exit code. A `prepare` pass is never itself prepared. A ticket killed mid-revert
stays doomed: its merge was on its way off the branch, and putting it back is the one thing recovery
must not do.

**Interrupts.** The first stops new work and lets what is running finish, then finishes the run as
the partial one it is. The second kills outright and exits `130`; the next start picks the wreckage
up.

## What reaches the tracker

Exactly two writes, both through `gh`:

- **the claim** — the ticket is assigned to you when its setup starts, so a colleague can see it is
  taken;
- **the spec PR** — opened at the end, with one `Closes #<n>` per verified ticket appended by the
  script rather than by an agent.

A failed claim halts the run: it is a collision guard, not bookkeeping. A ticket that is set up
twice is claimed twice, which changes nothing on the tracker. A claim is never released,
`--force-fresh` included — an attempted-and-failed ticket should be findable afterwards. No progress
comments, no labels, no notes on ticket issues. `--force-fresh` closing the pull request it opened
is the undoing of one of the two writes, not a third.

## What afk never touches

It never pulls, never moves trunk, and never modifies your working tree. It fetches the remote
trunk read-only to compare, and says what it found: being behind or dirty is a warning on the
confirmation screen, being ahead is a note, and all three are yours to decide on. Under
`--implement-only` they print and the run proceeds.

Uncommitted changes are not part of a run and cannot become part of one. Commits you have not
pushed *are*: the spec branch is cut from your local trunk on purpose, so a refactor or an ADR you
committed first is visible to every implementer.

## Records

Everything a run writes lives in `.afk/<spec>/` inside the target repository, and the directory
ignores itself, so it never appears in your repository's status and nothing in it can be staged.

| | |
| --- | --- |
| `manifest.json` | the tickets, their edges, and the two commands as confirmed |
| `events.jsonl` | the append-only lifecycle log, one JSON object per line. A ticket's status is its last event, derived on read and never stored. The `plan` and `pull-request` entries are about the run and name no ticket |
| `gate/` | the gate worktree, re-created at every process start |
| `t<n>/` | one worktree per ticket, removed once the ticket is verified. A failed or skipped ticket keeps its own, along with its branch — that is what the prepare agent reads |
| `transcripts/` | one file per agent attempt, written as the stream arrives |

It is machine-local and deliberately not portable. What a second reader needs reaches the spec
branch's commits instead: each ticket is one squash commit carrying `afk-ticket: <spec>/<n>`, and a
revert carries `afk-reverted: <spec>/<n>`, so "which tickets landed" is answerable from a fresh
clone.

## Exit codes

| | |
| --- | --- |
| `0` | complete — every ticket verified, a ready pull request opened. `--plan-only` exits `0` too, having planned what it was asked to |
| `1` | partial — a draft pull request naming what did not land |
| `2` | misuse — the arguments were refused: a bad flag combination, or no terminal without an explicit mode |
| `3` | halted — afk refused to start, or the run stopped itself, or it opened no pull request |
| `130` | a second interrupt killed the run |

A refusal to *start* — no manifest to implement, a run that already exists, nothing that is a git
worktree, a confirmation the operator closed — is `3` rather than `2`: the arguments were fine, and
what went wrong is on disk.

## Preconditions, documented rather than checked

Some things afk needs cannot be checked without guessing, and a guess would refuse as often as it
would help. They are stated here instead:

- `gh` is authenticated for the target repository, and `claude` is authenticated.
- The repository documents its own conventions under `docs/agents/` — how it records that an issue
  belongs to a spec, how it records that one issue blocks another, and what its triage labels mean.
  The planner reads that documentation; afk holds no copy of any repository's conventions, and
  native sub-issues are not assumed.
- `setup` and `verify` can run unattended from the repository root: no watch mode, no prompt, no
  flag that needs a terminal.
- The confirmation screen is the only thing between a planner-authored command and your machine.
  Read it.

## Developing afk

```
npm run typecheck    # tsc --noEmit, erasable syntax only
npm run lint         # biome
npm run test         # unit and integration
npm run check        # all three, in order
```

The source tree follows `docs/agents/layers.md`: `domain`, `repository`, `infrastructure`,
`service`, `cli`, plus `assembly.ts`, which is not a layer. `test/` mirrors it, with `flows/` for the
scenarios that drive a whole run and `fakes/`, `fixtures/` and `contract/` beside them. An
integration test is one that uses a real external dependency — real git in a temporary repository,
or afk's own entry point in a real process — and nothing else is one.

Three seams carry the suite: the decision function called directly, which is where every scheduling
and recovery rule is asserted; the assembled run driven through fake ports; and the git port's
contract suite, run against the fake and against real git. The tracker and agent adapters have fakes
and no real counterpart, knowingly.

`CONTEXT.md` is the glossary — read it before naming anything. `docs/adr/` holds the decisions and
why they were made.
