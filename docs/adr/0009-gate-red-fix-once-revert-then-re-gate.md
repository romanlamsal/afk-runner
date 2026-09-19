---
status: accepted
---

# Gate red: one fix attempt, revert, then re-gate the reverted tip

**Decision**, when the gate goes red after a merge:

1. **One** fix-agent attempt, under a hard constraint — fix the cause, never the signal. No deleting
   a failing test, no loosening a type, no skipping.
2. Still red → `git revert` the merge, ticket failed, dependents skipped transitively.
3. **Re-run the gate on the reverted tip.** Green confirms the ticket was the cause. **Red halts the
   run**: the branch is broken independently of any ticket and nothing above it is trustworthy.

## Amendment: a kill is not an answer

An operator interrupted a run whose fix agent had made the right repair and not yet reported back.
The budget was counted off `fix` **start** events, so the attempt nobody answered had spent it; the
gate went red again, the merge was reverted, the revert was killed too, and the next resume opened
the spec PR on a tip nothing had proven. Step 3 was skipped without anything saying so.

**A budget is spent by an answered attempt, not by a started one.** A budget exists to stop a
*failure* repeating, and an attempt that never reported back is not a failure — `repairFor` already
reasons this way for every other step. The fix budget is the log's terminal `fix` events: a `fix`
the log left `running`, with nothing live behind it, is dispatched again however many times it is
killed. A `fix` that reported back — `ok` or `failed` — spends the one attempt, so "exactly one"
holds for the case it was written for. A fix picked back up after a kill reads the merge off the
killed attempt's start event, because that agent may have committed before it died and the merge is
still what the revert takes off.

**A revert the log left `running` is dispatched again.** It is made safe to repeat the way the merge
is: the `afk-reverted` trailer answers whether the revert commit already landed, and a repeat that
finds it goes straight on to proving the tip rather than reverting twice. Step 3 is therefore never
skipped by a kill: the reverted tip is proven, and red still halts the run.

**A ticket the sequence still has a move for has come to nothing.** Only the revert's own record
makes a ticket read as failed. What the sequence still owes a ticket is one function, asked by both
the schedule and the conclusion, so that the board, the run's exit code and the spec PR's draft flag
cannot disagree about it.

This supersedes the first consequence below where it says the budget is counted off start events,
and that a killed run cannot buy a second attempt: it can, and should, because it never had the
first answered.

## Considered options

- **Skip step 3.** Rejected. Without it the runner reverts every ticket in turn against a branch
  that was already broken, blaming each in sequence. Step 3 is what makes the localisation claim
  demonstrated rather than asserted.
- **`reset --hard` plus a force-push instead of `git revert`.** Rejected. Append-only history is the
  only thing compatible with a rolling pool holding worktrees off the tip. The revert pair vanishes
  in the spec PR's squash anyway.

## Consequences

- The fix agent gets exactly one attempt. This is a budget, not a retry policy. There is no loop to
  bound: the decision function gives the fix action once, for one red gate (ADR-0023). **The budget is
  derivable rather than asserted**: a fix is its own step, so it is counted off the log's `fix`
  start events like every other budget (ADR-0022). A run killed between a red gate and its revert
  cannot therefore buy a second one.
- **The revert undoes the fix attempt along with the merge.** Everything from the squash to the tip
  goes, in one revert commit, so that the tip the gate is then re-run on is the tree that was green
  before the ticket merged. Without that the re-gate would be asking about a tree nothing has ever
  proven, and the localisation claim would be weaker than it reads.
- **The trigger for the revert is *still red*, never the fix agent's own exit.** An attempt the agent
  reported as failed is proven like any other: a session that died after committing a fix that works
  leaves a green branch, and the branch is what afk proves. A failed attempt only changes what the
  log says when the branch turns out to be red anyway.
- The fix attempt is recorded as a **fix** — it was a second `gate` attempt until ADR-0022, which
  is why nothing could count it. The gate on the reverted tip is recorded as the **revert**'s
  outcome rather than as a gate: recording it as a gate would make a reverted ticket's last event
  read `gate: ok`, which is `verified` (ADR-0011).
- The revert commit carries an `afk-reverted` trailer, so that the spec branch's log still answers
  which tickets landed once history contains both the squash and its undoing.
- A red gate is more expensive than a rebase that would not land (ADR-0005), where nothing was
  merged and the branch is never touched. That asymmetry is deliberate and stays visible.
