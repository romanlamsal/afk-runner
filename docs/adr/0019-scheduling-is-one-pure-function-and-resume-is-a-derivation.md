---
status: accepted
---

# Scheduling is one pure function, and resume is a derivation

An earlier runner smeared its rules across three large functions, and gave recovery a **code path of
its own**: `--resume` read the state file, decided what looked unfinished, and dispatched
differently from a fresh start. Five bugs were found across three resume attempts on one live run,
and every one of them lived in that second path — in the half of the runner that only ran when
something had already gone wrong, which is the half nobody exercises.

**Decision: every scheduling and recovery rule lives in one pure function.**

```
nextActions(manifest, events, { inFlight, maxParallel, draining }) -> Action[]
```

It takes the manifest, the event log and the run's parameters, and returns the actions to start now.
It reads nothing, writes nothing and calls nothing. The driver races what it returns, appends each
end event as it settles, and asks again — **the driver holds no rules**.

**`inFlight` is the driver's live action set, passed in — never derived from events.** This is the
whole of the mechanism, and it is what makes resume a derivation rather than a mode:

- A `running` event whose action **is** in `inFlight` is a step that is happening.
- A `running` event whose action **is not** in `inFlight` is a step whose process is gone.

At process start `inFlight` is empty, so every stale `running` a killed run left behind is
recognised on the first tick, by the same function and the same rules a fresh run uses. **There is
no resume mode, and so there is no second path to get wrong.** `--resume` is consent to continue an
existing run; it changes no behaviour (ADR-0014).

## Considered options

- **Derive what is in flight from the event log.** Rejected, and it is the tempting one: the log
  already says `running`. But a log cannot distinguish a step that is running from a step that was
  running when the power went out — those are the same bytes. Only the process knows which of its
  own actions it started, so that fact has to come from the process.
- **Keep a resume flag the decision function reads.** Rejected. It reintroduces the two-path shape
  in miniature: every rule would then have a fresh-start reading and a resumed reading, and the
  resumed one would again be the one nobody runs.
- **Let the driver hold the cheap rules and the function hold the expensive ones.** Rejected.
  "Cheap" is not a stable category, and a rule in the driver is a rule that needs git, fakes and a
  loop to assert. The split would be re-argued at every ticket.

## Consequences

- **Most of the test suite is this function called directly** — no fakes, no fixtures, no git.
  Inputs are a manifest and a list of events; output is a list of actions. Slate membership and
  ordering, transitive skip, draining, the retry budget, merge-track seriality, stale detection and
  the gate-red sequence (ADR-0023) are all asserted here. The actions it may give are the steps
  themselves, one for one (ADR-0026).
- **The domain enforces merge-track seriality**: it never emits a second merge-side action while one
  is in flight. That is a correctness precondition, so it is asserted by a test rather than left
  implicit in the shape of the driver.
- The driver is small enough to read in one sitting, and what it does is: ask, start, race, append,
  ask again.
- **Adding a rule means adding a case to one function and a test beside it.** Adding one to the
  driver is the fault this record exists to name.
- The function is called again after every settled action, so it must be cheap and it must be
  **idempotent in the absence of new events** — asking twice with the same inputs returns the same
  actions.
