# Layers

Where server code goes and what it is allowed to touch.

**Preconditions.** The repository layer assumes a store that can be read and written. Where this
document says *transaction*, it assumes the store can apply several writes atomically; if yours
cannot, question 5 does not apply. *Table*, *row* and *aggregate* are used in the relational
sense — substitute your store's equivalents.

**Terms.** A *controller* is a boundary adapter: it resolves the caller, validates, calls into
one thing, and returns. It holds no rules of its own. `components.md` applies the same role to
route files on the client; the difference is writes — a server controller passes a write through
to one service, a route controller does not carry writes at all.

A *port* is an interface. A *driven port* is something the code calls: store an aggregate, send
a mail, put a file somewhere. A *driving port* is the interface to a use case: something a
controller calls. An *adapter* implements a driven port.

This document is written for review. The faults below are the ones a linter cannot see, because
they are about what a function *does* rather than where it imports from.

## The layers

| layer | what it is | may import | must not |
| --- | --- | --- | --- |
| **domain** | pure rules, and the driven ports those rules need. No I/O | other domain modules, and pure libraries — validation, date and money arithmetic | the store, an adapter, an implementation of any port, any library that reaches out of the process |
| **repository** | adapters for this system's own store. One aggregate each, composes nothing | the store client, the domain | another repository, and a service above all |
| **service** | use cases. **The only entry for doing something.** Receives what it needs | domain, and other services' driving ports | build its own dependencies, or write a table with its own queries |
| **infrastructure** | adapters for other systems: mail, rendering, third-party APIs, auth | domain | a service |
| **controllers** | boundary adapters: entry points, their validators | services, domain, session infrastructure | repositories, the store, the query builder |

The arrow runs one way — controller → service → repository → store — and the domain sits beside
all of it: every layer may import it, it imports no layer. Repository and infrastructure are both
adapter layers; they differ only in subject matter, one implementing ports for this system's own
store and the other for somebody else's.

**"Imports no layer" is about this system's modules, not about packages.** The test for a package
in the domain is whether calling it can reach outside the process: a store client, an HTTP client,
a mailer SDK, `node:fs` and a clock all can, so they stay behind ports. A validation library
cannot — it computes from its arguments and returns — so it is allowed, and so is any other
library of the same shape. Runtime validation is not an exception carved out for one package; it
falls out of the test.

A schema is a rule, not a description of one. `Invoice` — which fields exist, that an amount is a
positive integer, that a status is one of four — is the same statement as the functions beside it,
written in a form that also holds at runtime. Putting it in the domain is what keeps a single
constructor (question 3) possible: the controller validating input and the repository mapping a
row parse against the same schema instead of two drifting copies of it.

In the vocabulary of domain-driven design, **domain** is the model, **service** is the
application layer, **infrastructure** and **repository** are both infrastructure, and
**controllers** are the interface layer.

A controller resolves the caller, validates, calls **one** service function, and returns what it
gives back. Needing two is the signal that a use case has grown inside a controller.

## Ports and factories

**Driven ports live in the domain.** The rules declare what they need — store this order, send
this mail — and adapters in the repository and infrastructure layers implement it. The domain
names no implementation and imports none.

**Driving ports live beside the service that satisfies them.** A use case is not a domain
concept, so the domain never learns the name of one. This is what keeps the arrow pointing in one
direction.

**A service is a factory.** It takes its dependencies as arguments and returns its driving port.
Nothing inside it constructs anything.

```
// service/order.ts
export const createOrderService = (deps: {
  orders: OrderRepository        // driven port, from the domain
  invoices: InvoiceRepository    // driven port, from the domain
  mailer: Mailer                 // driven port, from the domain
  tx: TransactionRunner          // driven port, from the domain
}): OrderService => ({ ... })    // driving port, declared here
```

**Assembly is not a layer.** One module builds the adapters, calls the factories, and hands the
result to the controllers. It is the only place that knows both a port and its implementation.
Keep it separate from the factories: a service module exports a factory and nothing else, never a
ready-made instance beside it, because an exported instance is a dependency nobody declared.

**Atomicity crosses ports through a transaction port.** The service asks to run something inside
a transaction; repository methods take the context it hands back. The context is opaque in the
domain, so nothing there names the store or its client.

```
// service: two aggregates, one transaction
await tx.run(async (ctx) => {
  await orders.markSettled(ctx, orderId)
  await invoices.clearDunning(ctx, orderId)
})
```

## The review checklist

Seven questions, each answerable from a diff. The snippets are illustrative pseudo-code.

### 1. Does a service write a table another aggregate owns?

**In a diff:** an insert, update or delete inside a service, or a service reaching for a store
handle, against a table the file is not named after.

The write belongs to the repository that owns the table. The service hands that repository its
transaction context and keeps the deciding.

```
// service/order.ts — the fault
ctx.insert(invoices).values({ orderId, total })

// the fix: one call into the owning repository
invoices.createForOrder(ctx, { orderId, total })
```

### 2. Is the new use case in a repository, or in a controller?

**In a diff:** a repository module that gained an import of a sibling repository, of an
infrastructure adapter, or of a service. Or a controller body that grew past "call one service".

A controller that hands a repository a transaction and a callback has not delegated a use case,
it has inlined one: the deciding still happens in the controller.

```
// controller — the fault
await tx.run(async (ctx) => { /* seven writes, four aggregates */ })

// the fix
await orderService.acceptQuote(orderId)
```

### 3. Does this add a second constructor for the same row?

**In a diff:** a row shape for one table built in two places — commonly once on the server and
once in a client-side optimistic update, or in two services.

Two constructors drift, and the drift stays invisible until two parts of the system disagree
about a rule neither of them writes down. Decide the rule once in the domain and have both
spread it.

```
// domain/invoice.ts — settling also clears dunning, decided once
export const settledPatch = (at) => ({ status: "settled", settledAt: at, dunningStage: 0 })
```

### 4. Does the write invalidate every aggregate its service wrote?

**In a diff:** a write declaring one invalidation while the service it calls writes two tables.

Open the service and count the tables it touches — **including the ones reached through a
transaction context it handed to another aggregate's repository**. Every aggregate written needs
to be named. The write the screen is obviously about is the easy half; the one further down the
shared transaction is the half that gets missed.

```
// settleOrder writes `orders` and clears `invoices.dunning_stage`
// declared: ["order"]            — the fault
// declared: ["order", "invoice"] — correct
```

`components.md` is the client-side form of this question.

### 5. Did one transaction quietly become several?

**In a diff:** a function that opens its own transaction instead of taking the context it was
given; a loop that calls a write per item.

Moving a write out of a function tends to give it its own transaction. A repository method takes
the caller's context and opens nothing. Writes that must land together run inside one `run`; a
loop that calls `run` per item is one transaction per item, and a failure halfway leaves the use
case half-applied.

```
// the fault
for (const line of lines) await tx.run((ctx) => lines.insert(ctx, line))

// the fix
await tx.run((ctx) => lines.insertMany(ctx, lines))
```

### 6. Does a repository import a service?

**In a diff:** a service import inside a repository file.

The first two faults seen from the other end, and the cheapest to spot. It means a use case is
parked in a repository.

### 7. Does anything build its own dependency instead of receiving it?

**In a diff:** a concrete adapter imported into a service file, or constructed inside a service
body or a factory body, rather than passed in. Also: a module exporting a ready-made instance
next to the factory that produces it.

This one is invisible to the other six — the code sits in the right layer and imports nothing the
arrow forbids. What it breaks is substitution: the service can no longer be given a different
implementation, so its tests need the real one.

```
// service/order.ts — the fault
const orders = createPostgresOrderRepository(db)

// the fix: it arrives as an argument, and assembly decides which one
export const createOrderService = ({ orders }: { orders: OrderRepository }) => ...
```

## Tests

One section, deliberately self-contained.

**An integration test is one that uses a real external dependency** — a database, a broker, a
third-party API. Everything else is not, whatever it covers.

**The default suite uses no external dependency.** It must be fast enough that nobody thinks
about running it. Where a real dependency would appear, a fake implementation of the port appears
instead.

**Test the domain directly.** It is pure, it holds the rules, and it needs no fixtures, no fakes
and no setup. Most of what is worth asserting lives here.

**Test services against fakes.** A service receives ports, so a test hands it fakes and asserts
what the service *did*: which port it called, with what, and what it returned. Assert observable
behaviour, not the order of internal calls.

**Adapters are integration-tested by design.** An adapter's entire job is to talk to something
external, so a unit test of one asserts a mock of the thing it exists to reach. Unit tests pay
off there only for genuinely self-contained pieces — a query builder's output, a mapping
function.

**Keep the fakes honest with contract tests.** Write one suite per driven port, against the port
rather than any implementation, and run it twice: against the fake, and against the real adapter.
The second run is the integration test, and it is what stops a fake from drifting into a fiction
that passes while production breaks.

```
// one suite, two runs
describeContract("OrderRepository", () => createFakeOrderRepository())
describeContract("OrderRepository", () => createPostgresOrderRepository(testDb))
```

Make switching between them a flag rather than an edit: the fast run is the default, and the real
one is what you reach for when a failure makes you doubt the fake.

**What makes a good test here** is that it survives a rewrite of the thing it tests. It names
inputs and observable results. It does not name private functions, call counts, or the shape of
anything the module did not return.

## When to leave it alone

- **A service that only forwards to its repository is correct here**, not an unnecessary
  indirection. A controller's only door is a service, even when the service exports the same name
  again, so that deleting a repository fails inside the service that names it rather than at a
  controller naming a symbol.
- **A read across aggregates in a repository is a reporting read, not a use case**, as long as it
  writes nothing.
- **A service passing its transaction context into another aggregate's repository is the design
  working.** That is how several tables stay one transaction.
- **A use case touching three aggregates and naming three invalidations is correct**, not a
  breach of one mutation per use case.
- **A port with one implementation is not premature.** The second implementation is the fake, and
  it is what the default suite runs against.
- **Not everything gets a layer.** Code that asserts about the source tree rather than about the
  application sits outside these layers, and so does the module that assembles them.
- **The checklist is a prompt to look.** Concluding that a case is fine is a complete answer.

## What this does not cover

- Where UI code goes: `components.md`.
- Library, framework and file-naming conventions: the stack document.
- Whether a module that straddles two layers should be split now.
