# Components

Where UI code goes, and what a route file is allowed to do.

**Preconditions.** React, and a router that attaches data to routes (a loader, or a read
performed at the route). Without the router, only "Components split when they tangle" applies.

**Terms.** A *controller* is a boundary adapter: it receives a request, resolves what is
needed, calls into one thing, and returns. It holds no rules of its own. This document applies
that role to route files. `layers.md` applies the same role on the server; the two differ in one
respect, stated below.

## Routes are controllers

A route file holds the route definition and one controller component. Nothing else.

The controller reads what the screen needs and passes it down. Where a read arrives from —
route data, params, search, a cache — decides nothing, because reading makes the controller the
owner of nothing. What it owns is the screen: the whole read, and the one place the screen
reports failure.

It declares no `useState`. State that belongs to the route belongs in the **URL** as a search
param, where it survives a reload and a shared link. Everything else is view state, and views
own it. Holding something that looks like state is not a licence to hold state.

**A route controller does not carry writes.** This is the one place it differs from a server
controller, which passes a write through to one service. A write belongs to the region that
renders its button, along with its in-flight flag.

If a route file is growing, the question is not how to organise the route. It is which view has
not been extracted yet.

## A write declares what it makes stale

A write states which reads it invalidates. That declaration is a property of the operation, not
of the button, so it is written next to the operation and used where the button is — not passed
down from the route.

Calling a server operation directly from a region declares nothing. Nothing can be reviewed, and
it works only for as long as something else on the screen refreshes everything. When that
refresh is removed, the region shows stale data and nothing about the code looks wrong.

Which reads a write invalidates is asked of the code performing the write. `layers.md` question 4
is the server-side form of the same question.

## Never refresh twice

Two mechanisms are usually available: refresh the route's own read, or invalidate the specific
reads a write made stale. A screen uses one.

- **The screen reads through a cache**: each write invalidates the reads it made stale, and
  nothing refreshes the route.
- **The screen reads only through the route**: the controller owns that read, so it owns the
  call that redoes it, passed down to the region as a callback.

```tsx
// route: owns the screen's read, so owns the call that redoes it
<OrderList orders={data.orders} onChanged={() => router.invalidate()} />

// region: owns the button, so owns the pending flag and the failure
const { attempt, failure } = useAttempt(onChanged);
```

Doing both is not redundancy. It is two mechanisms refetching the same rows on every write, and
it is invisible, because nothing about it looks wrong.

Either way the **screen's one error surface stays at the route**. On a cache-backed screen that
is all it does: it displays failure and refreshes nothing.

## Components split when they tangle

**Over 250 lines, or five or more `useState`: stop and evaluate.** Either condition trips it.
The numbers are a starting calibration; adjust them per repo, but keep them numbers. Length and
tangle are different things — a component holding seven pieces of state in 210 lines is the case
a line-only alarm walks past.

**Split into a compound only when three or more pieces of state are read by two or more distinct
regions.** That is the condition under which a root-with-context removes something. Below it,
splitting adds files and takes nothing away.

A compound is a root that owns the shared state, with sibling parts composed inside it and
exported flat:

```
src/components/order/
  root.tsx        OrderRoot      — owns the context and the state
  lines.tsx       OrderLines
  invoices.tsx    OrderInvoices
  context.ts      the shape the root provides
  index.ts        re-exports
```

```tsx
<OrderRoot order={order} onChanged={refresh}>
  <OrderLines />
  <OrderInvoices />
</OrderRoot>
```

Flat names, not `Order.Root`. The structure is the point; the namespace object is not.

## When to leave it alone

Splitting costs files, indirection, and a reader following an import to find ten lines. Do not
split when:

- **There is one region.** A long form with one submit is long. Six inputs in sequence are not
  six concerns.
- **There is no shared state.** A list renderer of any length is a list renderer. Extract the row
  if it helps; do not build a context for it.
- **The state is not actually shared.** Three `useState`, each read by one region, is three
  independent pieces of state in a file.
- **It is small.** Two components in thirty lines is fine.
- **It is being done to hit a number.** The alarm prompts a look; concluding that the component
  is fine is a complete answer.

## What this does not cover

- Where a component lives once extracted: one file in `src/components/` until it earns a
  directory, which is when it becomes a compound.
- Prop drilling two levels deep. That is two props, not a reason for context.
- Library and file-naming conventions: the stack document.
