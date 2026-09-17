# service

Use cases, and the only entry for doing something. Each is a factory taking its ports and
returning its driving port.

Services here are thin by design: perform one action through a port, append a lifecycle event.
Every rule lives in the domain.

The driver (`drive.ts`) is the one loop, and it is thin for the same reason: it asks the decision
function what to start, starts it, races what is in flight, appends what settled, and asks again.
It holds no rule about *what* to start (ADR-0019).

See `docs/agents/layers.md`.
