---
status: accepted
---

# A broken setup is recut, never repaired

`setup` is a step of its own (ADR-0022): the claim, the worktree, the environment files and the
repository's own setup command. Every other broken step gets a prepare agent (ADR-0012), so the
question is whether this one does.

**Decision: it does not. A `setup` that failed or was killed is thrown away and cut again** — afk
removes the worktree, cuts a fresh one from the spec branch's tip and runs setup again. **The step
carries a budget of its own**: the attempt and one more, counted off its own start events, and then
the ticket fails and its dependents are skipped.

Two reasons. A half-installed dependency tree is not a problem that rewards judgement — the cheap
repair is the correct one, and `checkoutWorktree` already removes by force. And a setup command that
is simply wrong must fail the ticket rather than be nursed: a step with no budget of its own is a
step that can repeat across restarts without bound, which is the hole ADR-0022 closed and must not
reopen.

**The recut is counted like any attempt.** ADR-0012 has it that a stale step is always repaired
whatever the budget says, because a killed process never answered for itself; here the repair *is*
the recut, and it spends one of the two. A killed setup that is recut and killed again fails the
ticket.

## Considered options

- **Send the prepare agent, as every other broken step does.** Rejected. Nothing was named that the
  agent would usefully do to a half-made worktree that the recut does not do faster and with
  certainty, and it would put a judgement-heavy agent on the most mechanical step there is.
- **Share the implement budget**, so that setup and implement together get two attempts rather than
  two each. Rejected. The two fail for unrelated reasons — one is the machine, the other is the work
  — and a ticket that lost both its attempts to a broken network would never reach an implementer.

## Consequences

- `setup` is in `STEPS` and not in `BROKEN_STEPS`. It has no row in ADR-0012's instruction table,
  and that is deliberate rather than an omission.
- A ticket can be claimed twice, because the claim is the setup step's first act and the second
  attempt repeats it. Assigning an already-assigned ticket to the same user changes nothing on the
  tracker, and the claim is never released either way (ADR-0013).
- A ticket costs at most two setups and two implements before it is abandoned. Only the implements
  spend an agent.
- The second setup differs from the first by the fresh worktree, and by nothing else. A wrong setup
  command therefore fails twice, at the price of running it twice — no agent, and no operator.
