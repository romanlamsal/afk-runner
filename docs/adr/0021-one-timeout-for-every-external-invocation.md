---
status: accepted
---

# One timeout, one hour, for every external invocation

afk runs unattended overnight. Every slow thing it does is a process it started: an agent, the
operator's `setup`, the operator's `verify`. Any of them can wedge — a model call that never
returns, an install waiting on a prompt nobody will answer — and a wedged process in a pool of three
slots costs a third of the night for as long as it hangs.

**Decision: one constant, one hour, applied to every external invocation afk makes.** Agents,
`setup` and `verify` alike. It lives in the domain (`INVOCATION_TIMEOUT_MS`) because it is a rule
about the run, and the adapters that spawn processes read it.

**A timeout is an ordinary failure.** It is recorded as the step failing, with the duration in
`detail`, and it goes through the same recovery path as any other failure — one prepare pass and one
retry (ADR-0012) — and it consumes the attempt. There is no timeout-specific branch anywhere,
because `detail` is never branched on and the **step** is what recovery keys on (ADR-0011).

The process is asked to stop and then killed if it will not: a first signal, a grace period, then an
outright kill. An invocation that ignores the first signal must not keep the slot anyway.

## Considered options

- **A timeout per role**, tuned to what each is expected to cost. Rejected. The numbers would be
  guesses, they would need maintaining as prompts and repositories change, and every one of them is
  a new thing that can be wrong. One number that is obviously too generous is easier to defend than
  five that are each nearly right.
- **No timeout; let the operator notice.** Rejected. The whole premise is that nobody is watching.
- **Infer the timeout from how long the process ran.** Rejected — and this is a real distinction the
  implementation keeps: the timeout is *owned* by the code that spawned the process. A process
  killed from outside is not a timeout, and recording it as one would send it down a recovery path
  that assumes afk's own clock fired.
- **Make the timeout configurable.** Rejected. Spec #4 admits no flag beyond its stated surface, and
  a knob here would be tuned once, in a panic, and never reviewed.

## Consequences

- **One wedged invocation costs a slot for an hour, never for a night.** With three slots, the worst
  case is bounded and the run keeps moving around it.
- An hour is generous enough that a legitimate long `setup` or a genuinely large ticket is not cut
  off. If a repository ever needs longer, the constant is one line and this record is where the
  argument goes.
- Because a timeout consumes an attempt, a step that wedges twice is a step that fails for good —
  which is correct: nothing about the second hour was more likely to work than the first.
