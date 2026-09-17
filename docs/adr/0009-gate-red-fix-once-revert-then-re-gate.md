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
