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

- The fix agent gets exactly one attempt. This is a budget, not a retry policy.
- A red gate is more expensive than a rebase that would not land (ADR-0005), where nothing was
  merged and the branch is never touched. That asymmetry is deliberate and stays visible.
