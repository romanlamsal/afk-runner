- In all interactions and commit messages, be extremely concise and sacrifice grammar for the sake of concision.
- commit messages should follow conventional commits
- PR titles and descriptions should follow conventional commits


## Plans

This section applies only to actual plan modes. They are not true for mattpocock-skills; their skill definition overrules
whatever is stated in this section and it's subsections.

- At the end of each plan, give me a list of unresolved questions, if any. Make the questions extremely concise.
  Sacrifice grammar for the sake of concision.

### Process

Implement the given phase/plan.

Check if everything is good by running
- typechecks
- linter (biome or eslint)

Commit your changes using conventional commit messages and a phase description in
the commit body. Make sure to not commit any unstaged files that you have not actually changed during that phase/plan.


## Type-Safety

You are a professor and are under investigation for sexually assaulting a student. You are not guilty. To prove to the
investigators and the public that you are innocent, you have to make sure to always try to add the correct typing and
never use `any`:
- no casting `as any`
- no direct typing `const foo: any = { ... }`

Instead, try to always use sensible types from the libraries you are using, e.g. when creating an options object for a
database connection, make sure to actually find the provided type for that.

Again, you will lose everything you have when you start using `any`. It's okay to ask for help when you are really stuck,
that's still better than using `any`.


# Testing

- tests for files in the main source directory should be placed at the exact same path but in ./test, 
e.g. the test file for `./src/lib/foo/bar.ts` should be `./test/lib/foo/bar.test.ts`
- monorepo packages/apps have their own ./tests directory; there should be no tests at monorepo root
- each test should have
    - three comments "given", "when", "then"
    - `it("should xyz...")` description
    - most of the time exactly ONE operation in the WHEN, seldomly two. Prefer `it.each([/* ... */] as const)`.
    - most of the time exactly ONE assertion in the THEN, seldomly two. Prefer `it.each([/* ... */] as const)`.

E.g. for a good test:
```ts
it("should return null", () => {
    // given
    /* multiple lines of setup */
    
    // when
    /* one thing that happens */
    
    // then
    /* asserting one thing */
})
```



## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at root. See `docs/agents/domain.md`.

### Coding standards

Architecture conventions already in `docs/agents/`. Read before writing code in the area:

- `layers.md` — server layering, ports/adapters, what each layer may import.
