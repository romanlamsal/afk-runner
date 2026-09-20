---
status: accepted
---

# A live holder of a run can be taken over

ADR-0036 made a second start against a live holder a flat refusal. That is the right answer for a
script and the wrong one for a person who has lost track of a run: the only way past it was finding
the holder's terminal, or its pid, by hand.

**Decision: on a terminal, a live holder is an offer — take it over, yes or no, defaulting to no.
Off a terminal there is no prompt and no flag, and the refusal stands.**

- **Only a yes is a yes.** An empty answer, anything else typed, and a closed input all decline, so
  nobody takes over by hitting return. It is the same accept-or-abort shape as the confirmation
  screen (ADR-0014), asked through the same operator port, and asked before it.
- **Declining leaves the holder alone** and refuses the start, naming the holder as ADR-0036's
  refusal does.
- **Accepting sends the holder its own interrupt twice.** That is precisely the shutdown afk already
  has (ADR-0016): the first drains, the second kills every child it started and exits. So a takeover
  leaves no orphaned agent writing into a worktree the new run is about to use, and no registry of
  child pids is kept on disk. The two are sent half a second apart, because two of one signal sent
  back to back can arrive as one.
- **The new run waits for the lock to actually free**, looking at it until it stops naming the
  holder, before anything else happens. A lock a third afk took in the meantime is that afk's, and
  is refused naming it rather than taken from it: only the holder the operator was offered is ever
  signalled.
- **A holder that will not go is killed outright** after a grace period, so a wedged process cannot
  hold a spec hostage. A holder still there after that is refused, naming it.
- **A start that would refuse anyway offers nothing.** The flags and the records are asked first, so
  that saying yes to a takeover cannot kill a live run and then refuse the start that killed it —
  two dead runs. The holder is still what the operator hears about first (ADR-0036).
- **Starting over takes over too.** `--force-fresh` against a live run is offered the same takeover,
  and throws nothing away until the holder is gone.
- **The signals are the lock adapter's.** The port gains `interrupt` and `kill`; the domain says what
  a takeover is given, the service decides the order, the adapter owns the pid and the signals.

## Considered options

- **A `--take-over` flag.** Rejected: taking over kills somebody's run, and a flag in a script's
  command line would do it every time, unattended, including to a run that was never lost.
- **Kill the holder straight away.** Rejected: an outright kill is what a wedged process gets. A
  holder that can drain records what it was doing, and its own second interrupt already takes its
  children with it.
- **Record the holder's children, and kill them from the new run.** Rejected for the reason ADR-0036
  gives: the holder's own shutdown already knows them.

## Consequences

- **A holder killed outright leaves its children running** — they were started detached, in groups of
  their own. That is the price of a process that would not run its own shutdown, and is why the
  interrupts come first.
- **A pid can be reused** (ADR-0036). A takeover offered against a lock naming a stranger's process
  signals that stranger. The offer names the pid, which is the operator's chance to say no.
