# service

Use cases, and the only entry for doing something. Each is a factory taking its ports and
returning its driving port.

Services here are thin by design: perform one action through a port, append a lifecycle event.
Every rule lives in the domain.

See `docs/agents/layers.md`.
