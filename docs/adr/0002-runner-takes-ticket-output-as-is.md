---
status: accepted
---

# The runner takes the ticketing skill's output as-is

One spec was ticketed into three sibling tickets that all extended the same enum and hooked the same
save action. The overlap was unavoidable given how the work was split, and it produced conflicts
between siblings that had no dependency edge between them.

**Decision: neither the planner nor the runner second-guesses ticket granularity, scope or overlap.**
Whatever the ticketing skill produced is executed as written.

## Considered options

- **Teach the runner to detect overlapping work and serialise it.** Rejected. Detecting that two
  tickets will touch the same code means predicting what an implementer will write, and the fallback
  — serialising anything that looks adjacent — gives back the parallelism the runner exists for.
  Ticket shape is the ticketing skill's problem; the runner owns execution and must survive whatever
  it is handed.

## Consequences

- Overlapping siblings conflict at rebase. ADR-0005 makes that the routine path rather than an
  exceptional one, which is what makes this decision affordable.
