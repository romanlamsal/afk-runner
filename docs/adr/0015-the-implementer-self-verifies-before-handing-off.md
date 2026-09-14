---
status: accepted
---

# The implementer self-verifies before handing off

The merge track is serial and single-writer (ADR-0006), behind a pool of parallel implementers. It
is the scarce resource in this design. Work that does not build costs a rebase, possibly a resolver
call, a gate, a revert and a re-gate (ADR-0009) before anyone learns of it — the cheapest class of
failure discovered in the most expensive possible place.

**Decision: an implementer runs `verify` on its own work, inside its own session, acts on the
result, and only then reports that it has implemented.** The script hands it the `verify` command
and still asserts only the two things in ADR-0004 afterwards.

## Considered options

- **Let the gate be the only place `verify` runs.** Rejected for the cost above. The gate still
  runs unconditionally (ADR-0008); this is in front of it, not instead of it.

## Consequences

- **A self-verify produces no status and no lifecycle event.** The closed `step` enum (ADR-0011) is
  untouched: a red self-verify that the implementer cannot fix surfaces as `implement:failed`, like
  any other implementer failure.
- **Only the gate produces `verified`.** An implementer's terminal claim is that it has implemented,
  and nothing more. No agent ever declares a ticket verified.
