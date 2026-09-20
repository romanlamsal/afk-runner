---
status: accepted
---

# The merge track is not a performance surface

ADR-0006 made one worktree the spec branch's sole writer and the merge track serial, and closed by
naming merge-track throughput — one serial track behind a pool of parallel implementers — the known
pressure point of the design. That was a prediction, made before a spec had been run. Six runs
across two repositories have now been measured, and it is wrong.

**Decision: the merge track is not where a run's time goes, and afk does not optimise it. A proposal
that targets scheduling, ordering or merge-side mechanics is refused unless it first shows, against
a measured critical path, that it reaches more than the 3–5% those mechanics cost.**

## What was measured

Every figure is derived from the `at` stamps already on each lifecycle event; nothing was
instrumented. Two repositories, deliberately unalike: this one, which verifies in 5s, and a 14-package
product monorepo whose verify is `typecheck && lint && eight check:* && test`.

Each run's critical path was traced backwards from its last event and every minute of it attributed:

| run | implement | resolve | fix | gate | rebase+merge |
| --- | --- | --- | --- | --- | --- |
| `stratum/1074` | 69% | 14% | 7% | 3% | 0% |
| `stratum/1117` | 76% | 9% | 4% | 4% | 0% |
| `afk/26` | 68% | 14% | 9% | 2% | 0% |
| `afk/43` | 79% | 10% | 0% | 1% | 0% |

**~90% of every critical path is an agent thinking.** Git and the repository's own commands are 3–5%
combined. `rebase` and `merge` are 0s at every percentile: both are one git invocation on a tree that
was already rebased, which is what being serial and single-writer bought.

The queue nobody is standing in: merge-track utilisation peaks at 0.50, and queueing across 31
measured tickets totals 32 seconds. The implementer pool is not the constraint either — mean
occupancy 2.14 of 3 slots, and no critical-path step in any run waited more than 0.2min for one, so
raising `--max-parallel` would have changed none of these makespans.

The 6× gate spread between the two repositories does not move the ratio, because merge-side cost and
implement cost grow together: the gate went 5s → 32s, and implement went 293s → 609s alongside it.
Pointing afk at a larger repository does not bring this pressure point about.

## Considered options

- **Order the merge track cheapest-first, probing with `git merge-tree`** (#2). Rejected on the
  numbers, and the probe's own cost was never the objection — `merge-tree` would be as free as the
  `rebase` it predicts. There is simply no queue to reorder. Worse, the lever points backwards: in
  the one measured case where the merge track did stall the pool, the ticket holding it up was the
  *conflicted* one, and it blocked two others. Cheapest-first would have merged it later still.
- **Implement a ticket and its dependents on one shared worktree**, so intra-chain conflicts never
  reach a rebase. Rejected, though its premise is sound: two of five genuine conflicts are exactly
  that shape and would vanish. It loses by 7–9min on both runs anyway, because the tickets that
  would share a worktree are the ones running in parallel today. Grouping is only well-defined over
  connected components of the blocker graph, and those components are wide rather than deep — on
  `stratum/1117`, seven tickets collapse into two, capping the pool at two implementers where three
  were measured. It trades fan-out for chain, and fan-out is where the parallelism is.

## Consequences

- **ADR-0006's first consequence is strengthened, not weakened.** Seriality is a correctness
  precondition rather than a performance choice — and now demonstrably so, because there is no
  performance being traded away for it. Its third consequence is superseded by this ADR; the
  decision it records is untouched.
- **The levers that remain are upstream of the runner.** Agent duration is a matter of profiles
  (ADR-0027); DAG depth is a matter of how the planner carves (ADR-0003). `resolve` and `fix` are
  not negligible — together a fifth of `stratum/1074`'s wall-clock, the second-largest category after
  `implement` — but they are agent time too, reachable by causing fewer conflicts or by running a
  different profile, never by scheduling.
- **The measurement is repeatable because the log already carries it.** Every number here came out of
  `events.jsonl` files written by runs that predate the question, which is the property ADR-0011
  bought and the reason this decision could be made from evidence rather than from argument.
- **This is a refusal, not a prohibition.** A future proposal is not forbidden; it is asked for a
  critical path first. The threshold is deliberately stated as a share of a measured run rather than
  as a wall-clock figure, so it survives a repository whose verify is slower than anything measured
  here.
