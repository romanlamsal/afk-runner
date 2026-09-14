# afk

Runs a whole spec's tickets unattended: plans the layers, implements them in parallel, merges each
one, resolves conflicts, verifies the assembled result, and leaves a stack of PRs.

## Requirements

- Node >= 23.6 — native TypeScript type stripping, so `node main.ts` runs with no build and no `npx`
- `gh`, authenticated for the repo
- `gh extension install github/gh-stack` (public preview)
- Tracker: GitHub Issues. A **spec** is an issue; its **tickets** are its sub-issues.

No `package.json`, no dependencies, `node:` builtins only. Copy this directory into any repo.

## Usage

```
node afk/main.ts <spec-issue> [--max-parallel 3] [--dry-run] [--resume | --force-fresh]
```

`--force-fresh` deletes every `afk<spec>/*` remote branch, closes any PR still open on them, and
clears `.afk/<spec>/`. There is no confirmation prompt: the flag is the consent, and a prompt would
defeat the point of the tool.

## Files

| file          | role                                                            |
| ------------- | --------------------------------------------------------------- |
| `main.ts`     | the orchestrator, single file                                    |
| `schema.ts`   | zod schema for the manifest — source of truth                    |
| `schema.json` | generated from `schema.ts`, committed, passed to `--json-schema` |

Node resolves bare specifiers relative to the importing **file**, not the cwd, so `zod` is usually
unreachable from a top-level `afk/`. `schema.json` is therefore committed and always used.
`main.ts` tries to import `schema.ts` at startup; where zod does resolve it regenerates and warns on
drift. Nothing degrades where it doesn't. Regenerate by running `schema.ts` from a directory where
zod resolves.

## Preflight

The run refuses to start unless all three hold:

- **`gh-stack` is installed.** It is the last thing a run uses; a missing extension must fail before
  the first ticket, not after every one of them.
- **`<trunk>` and `origin/<trunk>` are identical.** If local is ahead, push first. The remote trunk
  has to contain the base or the root PR's diff is meaningless.
- **No unexplained `state.json`.** If `.afk/<spec>/state.json` exists and neither `--resume` nor
  `--force-fresh` was passed, the run refuses and names both.

## Pipeline

### 1. Plan

`claude -p --json-schema schema.json`

Reads the spec's sub-issues, parses each `## Blocked by` section, resolves the references, emits
topological layers.

The planner **reads; it does not plan.** Scope, granularity and edges are what `/to-spec` and
`/to-tickets` already produced. It exists only because GitHub's native issue dependencies are
usually unpopulated while the ticket bodies state the edges in prose.

```ts
{ spec, trunk, layers: [{ branch, tickets: [{ number, title, branch, blockedBy }] }] }
```

A resumed run **reuses the existing manifest and never re-plans**: re-planning would produce
different layers as tickets close underneath it, and the manifest is the thing you read before bed.

### 2. Branch names

```
layer    afk<spec>/layers/<n>
ticket   afk<spec>/layer<n>/<ticket>-<slug>
```

The layer branch is deliberately *not* `afk<spec>/layer<n>`: git cannot hold both
`refs/heads/…/layer1` and `refs/heads/…/layer1/53-x`, since one would have to be a file and the
other a directory. The slug is the ticket title, slugified by the script.

### 3. Per layer, in manifest order

The layer branch is cut from the previous layer's tip; layer 1 from the trunk.

**Implement track** — a rolling pool of `--max-parallel` (default 3). A slot refills the moment any
implementer exits; nothing waits on a batch boundary. Each implementer gets its own worktree, cut
from the layer branch's **current** tip, so later tickets build on siblings that have already
merged.

- prompt: `/implement #<n>` — **commit only**, no push, no PR, no merge commits, and **never**
  rebase, merge, pull or reset onto anything else
- flags: `--permission-mode auto --permission-prompts none --disallowedTools "Bash(git push:*)"`
- `--session-id <uuid>`, recorded in `state.json`, so the session can be resumed rather than
  reconstructed
- `--output-format stream-json`, streamed to `.afk/<spec>/t<n>.log` as it arrives
- after it exits, the script checks the branch contains **no commit the layer branch lacks**

A ticket that fails is retried once through `retryStrategyFor(failure)` — today that returns
`resume` for every failure kind, and the mapping exists so a future divergence is discoverable
rather than folklore. If it fails again it is skipped, and every ticket declaring it in `blockedBy`
is skipped transitively.

**Merge track** — runs concurrently with the implement track, single and sequential. Consumes
finished branches in **completion order**; tickets within a layer are independent by construction,
so order carries no meaning.

```
push → gh pr create --base <layer-branch> → poll mergeable → gh pr merge --squash
```

Merging is **eventually consistent**. After any push, `mergeable` is polled until it is no longer
`UNKNOWN`, and the merge itself is retried with backoff. Treating a merge error as terminal costs
real tickets; every one observed so far was a race, not a conflict.

The ticket PR squashes with GitHub's default body — the implementer's own commit messages. No
`Closes` line goes here: only the layer PR reaches the trunk, so a ticket-level one would never
fire. On a successful squash the **remote** branch is deleted; the local one stays.

**Conflict** → a dedicated resolver worktree on the ticket branch; merge the layer branch in;
`claude -p "/mattpocock-skills:resolving-merge-conflicts"`; force-push; retry the squash. The
resolution is its own commit, the commit body says a conflict was resolved and where to read about
it, and the full note is posted as a comment on the ticket PR — it belongs where you review, not in
`git log` forever. The script `--abort`s only on a non-zero exit or a tree still conflicted after
the agent exits; the skill itself never aborts.

A layer is done when the pool is empty **and** the merge queue is drained.

### 4. Verify the assembled layer

An agent reads the repo's own documentation, runs whatever it says verifies this project, and fixes
what the layer broke. Its fix is **its own commit** on the layer branch: by this point the ticket
PRs are squash-merged, so amending one would diverge the branch from a closed PR.

Its hard constraint is **fix the cause, never the signal** — no deleting a failing test, no
loosening a type, no `skip`.

If it cannot fix the cause, **the run halts**. A failed ticket is isolated; a broken layer is the
base every layer above it builds on.

This stage exists because every other check can be green while the layer is broken: each
implementer verified its own branch, each conflict resolution ran the full suite, and the assembled
layer still failed to compile — two tickets in one layer, no textual overlap, one moving a type the
other had just imported.

### 5. The layer PR

Created at layer completion, not at the end. An agent writes the **title and prose**, following
whatever commit convention the repo documents, so that squash-merging it produces a well-formed
commit. The **script** appends one `Closes #<n>` per ticket in that layer, composed from the
manifest.

That split is deliberate. The title is judgement — one conventional-commit type across eight mixed
tickets. The `Closes` list is mechanical, and it has already failed twice by two different routes
when left to judgement.

`gh pr merge --squash --body` *replaces* GitHub's concatenation rather than appending to it, so the
script composes the whole body: the ticket squash bodies, then the `Closes` lines.

### 6. Stack

`gh stack link --repo <owner/repo> <layer branches…>`. Branches that already have a PR keep it, so
this links what step 5 created rather than making new ones. The bottom layer's PR is the root.

`--repo` is not optional: a `url.<alias>.insteadOf` rewrite in git config defeats `gh-stack`'s
repository resolution, while plain `gh` copes.

## State and resume

`.afk/<spec>/state.json` records what was being done:

```ts
{ spec, trunk,
  layers:  [{ branch, status }],
  tickets: [{ number, status, branch, prNumber, sessionId, worktree }] }
```

`status` is `pending | implementing | implemented | merged | failed | skipped`.

**GitHub is the truth for what landed; the file is only the truth for what was being attempted.** A
file written by a process that was killed is exactly the thing you cannot trust, so resume asks
GitHub whether a PR merged rather than believing itself.

Steps are idempotent: merged → skip; branch with commits → straight to the merge track; worktree
without commits → discard and redo.

**Ctrl+C** stops starting new work and drains the merge queue; a second one kills immediately. An
implementer six minutes in is expensive to throw away.

## Design notes

- **Worktrees share one object store.** Implementer worktrees are scratch space for producing
  commits; the branches are already common to the repository. Nothing is merged *between*
  worktrees — the merge track works on refs and on GitHub.
- **Squash everywhere.** A GitHub stack requires linear history between its branches.
- **Every exit code is checked.** The run never prints `done` over a failure — it did once, and the
  stack silently never existed.
- **No repo-specific config.** Anything semantic — which ticket, what a label means, what verifies
  this project, how a commit is titled — is read by an agent from the repo's own docs. The script
  holds only mechanics: processes, worktrees, refs, PRs.

## Known limits

- The conflict agent resolves freely and never aborts, so a confidently wrong resolution is possible
  and unsignalled. The layer PR is where it gets caught.
- The verification agent fixes unsupervised. Its commit is separate so it is reviewable.
- Layer width comes from `/to-tickets`, not the planner. Wide layers mean more conflicts.
- `gh-stack` is public preview.
- GitHub only. Tracker calls are isolated so a local-files adapter is a second file, not a refactor.
