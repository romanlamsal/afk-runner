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

**Spec base**:
The local branch a spec branch is cut from, and the branch its pull request is opened against.
Decided once, when the spec is planned, and recorded in the manifest. afk reads it, compares it
against its remote, and never moves it (ADR-0018, ADR-0032).
_Avoid_: trunk, base branch, main, master

**Spec branch**:
`afk/<spec>/spec` — the single branch every ticket lands on, and the only branch a run writes to.
_Avoid_: integration branch, layer branch, base branch

**Ticket branch**:
`afk/<spec>/t<n>` — the branch one implementer commits on.
_Avoid_: feature branch, work branch

**baseSha**:
The commit a ticket's worktree was cut from, and the base its implementer asserts it built on.
_Avoid_: base commit, fork point, merge base

**Abort**:
Taking a ticket's own worktree back off a rebase that did not land, leaving its commits intact. The
prepare agent's backward move, and the script's alone — the conflict resolver never aborts
(ADR-0005, ADR-0012). It is local to the ticket and is **not** a revert: nothing on the spec branch
moves.
_Avoid_: revert, roll back, undo, reset

**afk-ticket trailer**:
`afk-ticket: <spec>/<n>`, carried by each squash commit on the spec branch. The git-side record of
which ticket landed, and the only witness in the one window where the log cannot say whether a
squash landed — a cross-check that guards, never one that dispatches (ADR-0011).
_Avoid_: marker, tag, annotation

**afk-reverted trailer**:
`afk-reverted: <spec>/<n>`, carried by the revert commit that takes a ticket back off the spec
branch. The last trailer naming a ticket is the one that says where it stands, which is what keeps
"ask git which tickets landed" answerable after a revert (ADR-0009).
_Avoid_: rollback marker, undo tag

**Spec PR**:
The one pull request a run opens — spec branch into the spec base, squash-merged. Opening it is the
last thing a run does, and merging it is the operator's (ADR-0007).
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

**Drain**:
Stopping a run without stopping what it is already doing: nothing new starts, every in-flight step
finishes and records its event, and the process then exits. What the first interrupt asks for, and
what a halt does on its way out. A merge a drain has already made is still gated, because the gate
is that merge's own proof rather than new work (ADR-0008). A drained run is a partial one, and opens
the pull request a partial run opens.
_Avoid_: graceful shutdown, soft stop, quiesce

## State

A ticket's life is a state machine. The statuses below are its states; the steps are the moves
between them. A status is not stored and is not a word of its own in the log — it is a reading of
the last lifecycle event, which is a step and an outcome together.

**Step**:
The named thing recovery keys on: one move a ticket makes, or one thing a run does. A phase that can
be killed on its own, or that carries a budget of its own, is a step of its own (ADR-0022). Most are
also actions the decision function can give (ADR-0026); the run-level ones name no ticket
(ADR-0028).
_Avoid_: phase, stage, state

**Setup step**:
Claiming the ticket, cutting its worktree, copying environment files in and running setup —
everything an implement attempt does before an agent exists. Named for its last act, it is more than
the setup command, and it is a step so that being killed part-way through it is visible. It is never
repaired: a broken one is thrown away and cut again, on its own budget (ADR-0024).
_Avoid_: bootstrap, provisioning, pre-flight

**Attempt**:
One pass at one step of one ticket, carrying its own session where an agent runs it and none where
the step runs commands. A ticket's second implementer attempt is a different attempt from its first.
Nothing an attempt does happens before its start event.
_Avoid_: try, run, invocation

**Started**:
A spec whose log names a ticket, and so a spec a run has begun for. A spec that has only been
planned is not started, its log notwithstanding (ADR-0028).
_Avoid_: in progress, live, under way, open

**Event log**:
`events.jsonl` in the run directory — the append-only record of every lifecycle event, one per line.
It is the record of what was attempted and how far it got.
_Avoid_: state file, journal, history

**Lifecycle event**:
One appended record of a step, its outcome and the attempt's session, for one ticket — or for the
run, where the step is a run-level one and the event names no ticket (ADR-0028). Appended when a
step starts — before the step's first act, not before its agent's — and again when it ends. Never
rewritten.
_Avoid_: log line, transition, history entry

**Budget**:
How many attempts a step gets, counted off the log. A budget exists to stop a *failure* repeating,
and an attempt a kill left `running` never reported back, so it is not one: the fix budget counts
**answered** attempts, its terminal events (ADR-0009). The others count start events, and
`repairFor` passes a step nothing ended without asking its budget; only a setup's recut spends one
on a kill (ADR-0024). Nothing stores a counter, so nothing can hold one
that disagrees; a budget no step can be counted for is asserted rather than derivable, which is what
made `fix` a step (ADR-0022). Each step counts its own, except a resolve, which spends its rebase's.
_Avoid_: retry limit, attempt counter, quota

**Status**:
A ticket's last lifecycle event. Derived on read, never stored. A ticket left `running` is one whose
step began and never reported back.
_Avoid_: state, phase, stage

**Implemented**:
A ticket whose implementer reported back and whose work has gone no further. What the merge track
draws from, exactly as the slate draws from verified blockers.
_Avoid_: done, finished, complete, ready

**Conflicted**:
A ticket whose rebase git stopped part-way. A state of its own rather than a failure, because git
draws the distinction and afk only reads it (ADR-0025). It is where the conflict resolver starts.
_Avoid_: stuck, unmergeable, broken

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

**Conclusion**:
What a ticket came to: verified, unverified, failed or skipped. One classification, decided in the
domain and nowhere else, because the run's summary, its exit code and the pull request's draft flag
all read it and a second route would let them disagree. A ticket never attempted or mid-step has
come to none.
_Avoid_: result, final status, verdict

**Board**:
What a run shows while it runs: every ticket of the spec at once, one row each, so its height is the
ticket count. A row is the ticket's number, its trail, and — where a step is running — how long that
step has been going (`| 58s`); a row with nothing running ends at its trail. Derived from the run
directory and an instant handed in, never from the driver's in-flight set: a step the log left
`running` is one whose end event is not written rather than one that is certainly happening, and the
elapsed figure counts up either way (ADR-0030, ADR-0034). Whether that step is still writing is
carried by colour: a step gone *quiet* draws as a warning. Nothing about it is written down, and
`afk <spec> --board-only` and a replay draw the same board from the same run directory.
_Avoid_: dashboard, monitor, progress view, TUI

**Trail**:
The steps on a board's row: every step of the run, in the order a ticket takes them, and the same on
every row whatever track the ticket is on. Its words never change; colour carries what has happened,
what was begun and what is still ahead, and may carry whether a running step is still writing
(ADR-0031). How long a step has run is not part of it: that figure comes after it, at the row's end.
_Avoid_: progress bar, timeline, breadcrumb

**Quiet**:
A running step that has written nothing for a while — three minutes. Read from the step's own
records, an agent's transcript or a command's log, each of which stamps every line with when it was
written; never from a file's modification time. It is evidence, not a verdict: a quiet step may be
thinking and may be dead, and the board says which it looks like rather than which it is (ADR-0034).
_Avoid_: stalled, hung, idle, dead

**Interrupted**:
A step the log left `running` whose action the driver does not hold: the step's process is gone, and
it is not happening. Only the live action set tells it from a step that is (ADR-0019), which is what
a resumed run is full of. It is the driver's distinction, drawn to decide what to dispatch; the
board does not draw it (ADR-0030).
_Avoid_: stale, orphaned, hung, zombie

**`.afk/`**:
The run directory — the event log, worktrees, agent transcripts. Machine-local; nothing in it is
expected to exist on another machine.
_Avoid_: cache, workspace, scratch

**Run lock**:
The run directory's claim that one afk process is running this spec, naming that process. A second
start refuses while its holder is live; a lock whose holder no longer exists is absent. Drawing the
board takes none (ADR-0034).
_Avoid_: mutex, pidfile, session

**Starting over**:
Taking a spec back to nothing: its worktrees, its branches local and remote, its pull request and
its run directory, all away in one act and without a prompt. It takes nothing back off the tracker —
a claim is never released (ADR-0013).
_Avoid_: reset, clean, wipe, rollback

## Tracker

**Claim**:
Assigning a ticket to the invoking user — the operation `docs/agents/issue-tracker.md` names. It is
the setup step's first act, so a ticket that is claimed always has an event. afk claims every ticket
it starts and never releases one.
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
Its one attempt is a budget, counted off the log's `fix` start events rather than asserted by the
code that calls it.
_Avoid_: repair agent, doctor, healer

**Prepare agent**:
The agent that makes a wrecked ticket fit for the normal track to pick up, before a retry mid-run or
before anything else on a resume. It never lands work. Three steps are never sent to it: `setup`,
which is recut instead; `fix`, which goes back to the gate; and `revert`, which is not undone.
_Avoid_: recovery agent, triage agent

**PR writer**:
The agent that writes the spec PR's title and summary.
_Avoid_: summariser, scribe

**Agent profile**:
What one role is invoked with: the model and effort of the agent afk starts, and the model of the
agents that one spawns. One per role, and the only thing distinguishing two invocations besides the
prompt and the schema (ADR-0027).
_Avoid_: tier, agent config, model settings

**Fan-out**:
The agents a role's skills spawn inside its own invocation. afk starts one agent per attempt and
never any of these, so a fan-out is reached only through the profile the attempt was given.
_Avoid_: subagents, sub-tasks, children

## Code

**Layer**:
One division of afk's own source tree — `docs/agents/layers.md`'s sense, and the only sense the word
has here. It never means a batch of tickets: the schedule is a flat DAG worked by the slate
(ADR-0001).
_Avoid_: tier, ring, level
