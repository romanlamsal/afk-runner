# TanStack Start + Query

File and library conventions for a TanStack Start app that uses TanStack Query. Assumes both.

The rules this implements are in `components.md` and `layers.md`. Those two say what must be
true; this one says what to type. Anything here that names a library or a filename stays here.

## File conventions

| suffix | holds |
| --- | --- |
| `<service>.fn.ts` | server functions — controllers in the sense of `layers.md` |
| `<service>.schema.ts` | validators for those server functions' inputs |
| `<service>.queries.ts` | `queryOptions` and `mutationOptions` factories for one service |

One `.queries.ts` per service, and it is the only place cache keys are written. A route file is
not a layer: it is the route definition plus one controller component (`components.md`).

## Reads

A read is a `queryOptions` factory. The loader primes it; the controller consumes it.

```ts
// order.queries.ts
export const orderQuery = (id: string) =>
  queryOptions({ queryKey: ["order", id], queryFn: () => getOrder({ data: { id } }) });

// route
loader: ({ context, params }) => context.queryClient.ensureQueryData(orderQuery(params.id)),
```

The route controller performs the screen's read and passes the results down. Regions receive
data as props; they do not each open their own query for the same rows.

## Writes

A write is a `mutationOptions` factory next to the read, naming every key its service made
stale (`layers.md` question 4).

```ts
// order.queries.ts
export const settleOrderMutation = (qc: QueryClient, orderId: string) =>
  mutationOptions({
    mutationFn: (input) => settleOrder({ data: { orderId, ...input } }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["order", orderId] }),
        qc.invalidateQueries({ queryKey: ["invoice", orderId] }),
      ]);
    },
  });
```

Used where the button is, never handed down from the route:

```tsx
const qc = useQueryClient();
const settle = useMutation(settleOrderMutation(qc, orderId));
```

A write with no factory is the fault this convention exists to prevent. Calling a server
function straight from a region declares no keys, so nothing can be reviewed.

## `router.invalidate()` versus the query client

Pick one per screen; never both (`components.md`).

- **Cache-backed screen** — the loader primes keys and the route returns nothing the components
  read directly. Writes invalidate their keys. Nothing calls `router.invalidate()`.
- **Loader-backed screen with no cache** — the route owns the read, so the route owns
  `router.invalidate()` and passes it down as an `onChanged` callback.

Mixing them means two mechanisms refetch the same rows on every write, with nothing in the code
looking wrong. If that rule matters on a screen, pin it with a test that walks the screen's
imports and fails when `router.invalidate()` reappears.

## The error surface

One hook at the route holds the screen's failure — `useAttempt` or whatever it is called here.

```tsx
// loader-backed: it wraps the refresh and holds the failure
const { attempt, failure } = useAttempt(onChanged);

// cache-backed: mutations carry their own pending state, so it only displays
const { failure } = useAttempt();
```

Per-write pending state stays with the button that triggered the write (`components.md`).
