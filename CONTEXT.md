# afk

afk runs a whole spec's tickets unattended: it plans a DAG from the spec's tickets, implements
tickets in parallel, merges each onto one branch, resolves conflicts, verifies the assembled result
after every merge, and opens one pull request at the end.

## Work

**Spec**:
The GitHub issue whose tickets are the work of one run. Its number is the `<spec>` in every
branch and path afk creates.
_Avoid_: epic, feature, spec document

**Ticket**:
An issue belonging to the spec — how that belonging is recorded is the repository's own convention
(native sub-issues, a task list, a `Part of #<spec>` line in the body). The unit of work one
implementer takes.
_Avoid_: task, subtask, story

**Slate**:
The set of tickets whose every blocker is verified, ordered by transitive dependent count — most
first — and recomputed after each verification. Not `docs/agents/issue-tracker.md`'s *Frontier
query*, which keys on closed blockers and unassigned issues.
_Avoid_: frontier, ready queue, wave, batch

## Git

**Trunk**:
The local branch a spec branch is cut from — what `origin/HEAD` names, else `main`, else `master`.
afk reads it, compares it against its remote, and never moves it (ADR-0018).
_Avoid_: default branch, base branch, main, master

**Spec branch**:
`afk/<spec>/spec` — the single branch every ticket lands on, and the only branch a run writes to.
_Avoid_: integration branch, layer branch, base branch

**Ticket branch**:
`afk/<spec>/t<n>` — the branch one implementer commits on.
_Avoid_: feature branch, work branch

**baseSha**:
The commit a ticket's worktree was cut from, and the base its implementer asserts it built on.
_Avoid_: base commit, fork point, merge base

**afk-ticket trailer**:
`afk-ticket: <spec>/<n>`, carried by each squash commit on the spec branch. The git-side record of
which ticket landed.
_Avoid_: marker, tag, annotation

**afk-reverted trailer**:
`afk-reverted: <spec>/<n>`, carried by the revert commit that takes a ticket back off the spec
branch. The last trailer naming a ticket is the one that says where it stands, which is what keeps
"ask git which tickets landed" answerable after a revert (ADR-0009).
_Avoid_: rollback marker, undo tag

**Spec PR**:
The one pull request a run opens — spec branch into the repository's default branch, squash-merged.
Opening it is the last thing a run does, and merging it is the operator's (ADR-0007).
_Avoid_: layer PR, ticket PR, stack

**The push**:
Publishing the spec branch to its remote, once, immediately before the spec PR is opened. It is what
makes the pull request possible, and it is the only write besides the tracker's two that leaves the
machine — ADR-0013 counts writes to the *tracker*, and this is not one. It moves no branch and no
working tree; the upstream it records for the spec branch is the only local mark it leaves.
_Avoid_: publish, upload, sync

## Commands

**Setup**:
The planner-derived command that prepares a checkout for use.
_Avoid_: install, bootstrap, prepare

**Verify**:
The planner-derived command that proves a checkout's integrity.
_Avoid_: test, check, CI

**Self-verify**:
An implementer running verify on its own work, inside its own session, before it reports back.
Produces no status.
_Avoid_: pre-check, validation, smoke test

**The gate**:
Setup then verify, run on the spec branch after a ticket merges into it. It asserts the integrity of
everything merged so far, and it is the only thing that produces `verified`.
_Avoid_: verification step, integration test, CI run

**Proving the branch**:
Running setup then verify in the gate worktree with nothing written down. It is what the gate does
before it records a verdict, and what the revert asks about the tip it leaves behind — where a green
is a statement about the ticket that just failed rather than one that passed (ADR-0009).
_Avoid_: re-gating, checking, validating

**Gate worktree**:
The single long-lived worktree holding the spec branch checked out, and the sole writer to it.
_Avoid_: main worktree, scratch worktree

## Tracks

**Implement track**:
The rolling pool of implementer slots drawing from the slate.
_Avoid_: pool, layer, batch

**Merge track**:
The serial, single-writer sequence taking one ticket at a time from skip-check through rebase, merge
and gate.
_Avoid_: merge queue, merge worker

## State

**Attempt**:
One invocation of an agent for one step of one ticket, carrying its own session. A ticket's second
implementer attempt is a different attempt from its first.
_Avoid_: try, run, invocation

**Event log**:
`events.jsonl` in the run directory — the append-only record of every lifecycle event, one per line.
It is the record of what was attempted and how far it got.
_Avoid_: state file, journal, history

**Lifecycle event**:
One appended record of a step, its outcome and the attempt's session, for one ticket. Appended when
a step starts and again when it ends. Never rewritten.
_Avoid_: log line, transition, history entry

**Status**:
A ticket's last lifecycle event. Derived on read, never stored. A ticket left `running` is one whose
step began and never reported back.
_Avoid_: state, phase, stage

**Verified**:
A ticket whose gate went green — the only status the slate accepts as a satisfied blocker.
_Avoid_: done, passed, green, complete

**Merged**:
A ticket squashed onto the spec branch whose gate has not yet run.
_Avoid_: landed, integrated, shipped

**Unverified**:
A ticket a step got through that the gate has not proven — implemented, or merged. What a run
reports beside verified, so that a partial run never reads as a finished one.
_Avoid_: pending, unproven, in progress

**Reverted**:
A ticket whose merge was taken back off the spec branch by a revert commit, after the gate stayed
red through the one fix attempt. It is a failed ticket: nothing more happens to it, and its
dependents are skipped.
_Avoid_: rolled back, undone, backed out

**Skipped**:
A ticket that will not land, because a blocker failed or was reverted.
_Avoid_: cancelled, dropped, blocked

**Failed**:
A ticket that was attempted, could not land, and that a later resume may repair.
_Avoid_: errored, broken, stuck

**`.afk/`**:
The run directory — the event log, worktrees, agent transcripts. Machine-local; nothing in it is
expected to exist on another machine.
_Avoid_: cache, workspace, scratch

## Tracker

**Claim**:
Assigning a ticket to the invoking user when its implementer starts — the operation
`docs/agents/issue-tracker.md` names. afk claims every ticket it starts and never releases one.
_Avoid_: assign, lock, reserve

## Agent roles

**Implementer**:
The agent that produces commits for one ticket, on that ticket's branch in its own worktree.
_Avoid_: worker, builder, coder

**Conflict resolver**:
The agent that resolves a rebase conflict, in the ticket's own worktree.
_Avoid_: merger, rebaser

**Fix agent**:
The gate's single attempt to repair a red verify, constrained to fix the cause and never the signal.
_Avoid_: repair agent, doctor, healer

**Prepare agent**:
The agent that makes a wrecked ticket fit for the normal track to pick up, before a retry mid-run or
before anything else on a resume. It never lands work.
_Avoid_: recovery agent, triage agent

**PR writer**:
The agent that writes the spec PR's title and summary.
_Avoid_: summariser, scribe

## Deprecated

These terms describe the superseded implementation in `main.ts`. They are recorded so that code can
be read, not so that it can be extended. None of them may appear in the design that replaces it.

**Layer**:
A batch of tickets that ran in parallel, merged into a shared branch and was verified as a unit.
Replaced by the slate — ADR-0001. Unrelated to `docs/agents/layers.md`'s *layer*, which is a server
architecture tier and remains current; the collision is coincidental.

**Layer branch**:
`afk<spec>/layers/<n>`, the branch a layer's tickets merged into. There is now one spec branch —
ADR-0006.

**Ticket PR**:
A pull request per ticket into its layer branch. Merging is now entirely local — ADR-0007.

**Stack / `gh-stack`**:
The pull request stack linking layer PRs. A run now opens one spec PR — ADR-0007.

**`verifyLayer`**:
The per-layer verification pass, run once a layer's merge queue drained. Replaced by the gate, which
runs after every merge — ADR-0008.

**Stored `status` enum**:
`pending | implementing | implemented | merged | failed | skipped`, written into `state.json`. Status
is now derived from the event log — ADR-0011.

**`mergeable` polling**:
Waiting for GitHub to report a pull request mergeable before merging it, with a retry-and-backoff
loop around the merge. Gone with ticket PRs — ADR-0007.

**`merge-tree` probe**:
A check for whether a ticket would conflict, used to choose between a fast and a slow merge path.
Every ticket is now rebased unconditionally — ADR-0005.

**`changed-base`**:
An implementer failure meaning the ticket's branch was behind its layer branch. Being behind is now
the normal state of every ticket that is not first to merge, and is the merge track's business —
ADR-0004.
