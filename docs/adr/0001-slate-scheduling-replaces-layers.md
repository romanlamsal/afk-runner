---
status: accepted
---

# Slate scheduling replaces layers

Tickets form a DAG. An earlier design grouped them into topological layers and ran each layer as a
batch: implement the whole layer in parallel, merge it, verify it, then cut the next layer's branch
from its tip.

A layer did four jobs, and every one of them is done better at a finer grain:

| the layer's job | what replaces it |
| --- | --- |
| parallelism batch | a slate poll per free implementer slot |
| integrity gate | a gate behind each merge, whose red result names the merge that caused it rather than every ticket in the layer |
| review unit | one spec PR whose commits are the tickets |
| halt on a broken base | halt on a red spec branch — the same property at a finer grain |

Layers also cost the most where they help least: a one-ticket layer pays for a whole-layer
verification agent and a whole-layer PR-prose agent in order to wrap a single commit that was
already verified in isolation.

**Decision: there are no layers.** The manifest is a flat DAG. A rolling pool of implementer slots
each take from the slate — the tickets whose every blocker is verified — ordered
most-dependents-first, tie-broken by manifest order.

## Considered options

- **Keep layers and make thin ones cheaper.** Rejected: it treats the symptom. Once each of a
  layer's four jobs is done by something finer that the design needs anyway, the layer is left doing
  nothing but constraining the schedule.

## Consequences

- Ordering within the slate matters. Starting a blocker late stalls the pool, so the
  most-dependents-first rule is load-bearing rather than cosmetic.
- A dependent can now be in flight when its blocker is reverted, which layers made impossible. See
  ADR-0010.
