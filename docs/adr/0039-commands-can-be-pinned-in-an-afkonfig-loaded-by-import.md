---
status: accepted
---

# Commands can be pinned in an afkonfig, loaded by import

The planner derived `setup` and `verify` afresh every run (ADR-0003), and came back with different
ones from run to run on the same repository — and spent planner time doing it.

**Decision: a repository may pin either command, or both, in `afkonfig.ts` at its top level —
`export default { setup?: string, verify?: string }`. afk loads it with a dynamic `import()` and
validates the default export strictly. The planner is asked only for what is not pinned: a pinned
field is removed from the schema it must answer, afk writes the pinned value into the manifest
itself (as it does the base, ADR-0032), and the prompt names the pinned value so that what the
planner does derive fits it.**

Only an invocation that plans reads the afkonfig, and it does so before anything runs — before
`--force-fresh` deletes anything, and before the planner is spawned. `--implement-only` and
`--board-only` never read it: the manifest already carries the commands. A missing file pins
nothing. A file that fails to import, has no default export, has unknown keys, or has an empty or
non-string value refuses the invocation with exit `3`: a faulty afkonfig fails loudly rather than
silently falling back to the planner.

`afk config` is the file's own command: `--init` overwrites it with an empty template, `--check`
reports what is wrong with it, and bare it checks an afkonfig that exists and initialises one that
does not.

## Considered options

- **Parse the object literal statically.** Rejected. It forbids anything computed, and needs either
  a TypeScript parser as a dependency or a brittle pattern match. Node strips types natively, and
  `satisfies` is erasable, so an import needs nothing.
- **Look up the afkonfig in the invoking directory.** Rejected. afk plans, sets up and verifies at
  the repository's top level, so an afkonfig in a subdirectory would pin commands that then run
  somewhere else.
- **Near-miss detection** (`afkconfig.ts`, `.js`, `.mts`). Rejected: one name, nothing else.

## Consequences

- **Importing the afkonfig executes it.** It is the repository's own checked-in file, trusted as
  much as the package manifest's scripts; ADR-0014's worry is agent-authored strings, not this.
- A pinned command is not re-derived when the repository changes. Keeping it current is the
  repository's job, as keeping its CI configuration current is.
