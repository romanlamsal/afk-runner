---
status: accepted
---

# Base reconciliation belongs to the merge track, never the implementer

With a rolling pool, every ticket that is not first to merge is behind the spec branch by the time
its implementer finishes. An earlier runner checked three things after an implementer exited: that
it had built on the base it was given, that it had produced commits, and that its branch was not
behind. The third failed finished, green work mechanically the moment a sibling merged first — and
the merge track, whose conflict resolver was built for exactly that case, never saw it.

**Decision: an implementer asserts only that it produced commits on the base it was given, without
moving that base.** Two checks, deliberately kept separate:

- *did it build on that base* — `git merge-base --is-ancestor <baseSha> HEAD`
- *did it produce anything* — `<baseSha>..HEAD` is non-empty

**Being behind the spec branch is neither checked nor a failure.** Whether the spec branch has
advanced is not the implementer's business.

## Consequences

- Conflating "you built on the wrong base" with "the branch moved under you" is the bug this rule
  exists to make unrepresentable. They are separate assertions and must stay separate.
- The merge track is the only place a base is reconciled (ADR-0005) and the only place a conflict
  resolver is invoked.
