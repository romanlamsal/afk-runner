---
status: accepted
---

# Environment files are copied into every worktree

An implementer is expected to run the operator's own `setup` and `verify` in a worktree of its own.
A fresh worktree has the repository's tracked files and nothing else, so a repository whose tests
need a `.env` fails in every worktree afk makes — not because the work is wrong, but because the
environment is missing.

**Decision: the repository's ignored environment files are copied into every ticket worktree and
into the gate worktree, at the same relative path, when the worktree is created.**

**git is what finds them.** An environment file is one the repository ignores, and asking git which
files it ignores is the only way to learn that without afk inventing its own idea of an ignore rule.
Which of those ignored files are *environment* rather than build output is a rule, and it lives in
the domain (`isEnvironmentFile`) rather than in the adapter that reads the file system.

**They are copied, never symlinked.** A symlink makes every worktree a second name for one file: an
agent that rewrites a `.env` to debug something would be rewriting the operator's. A copy cannot do
that. The cost is that **rotating a secret mid-run does not reach worktrees that already exist**,
which is the right trade for an unattended run — a worktree's environment does not change under an
agent that is using it.

**Relative paths are preserved**, so `packages/api/.env.test` lands at `packages/api/.env.test` and
a monorepo's layout survives.

**Contents never cross the port.** The copy goes from one file to another; nothing reads a value.
No prompt afk composes and no line it logs can carry one, because nothing in afk has ever held one.

## Considered options

- **Copy every ignored file.** Rejected. `node_modules` and build output are ignored too, and
  copying them is both enormous and wrong — `setup` is what puts those in a worktree.
- **Symlink instead of copying.** Rejected above: one writable file shared by every agent in the
  pool.
- **Ask the operator which files to carry.** Rejected. It is another question on the confirmation
  screen (ADR-0014) for something git already knows, and an operator who answers it wrong finds out
  an hour later in a failed `setup`.
- **Put the worktrees outside the repository so no ignore rule is needed.** Rejected. Worktrees are
  git objects and belong in the run directory with everything else afk writes; the self-ignoring run
  directory (ADR-0013) is what keeps the copies out of the repository's status.

## Consequences

- **Secrets are written inside the operator's repository.** This is an accepted risk, carried
  knowingly: what protects them is the run directory's own ignore file, not the consumer's ignore
  rules. Nothing in the run directory can be staged by accident.
- A repository whose environment is not in ignored dotfiles — one that expects exported shell
  variables, say — is not served by this, and its `setup` will say so.
- Nothing rereads or refreshes a copy. A worktree's environment is whatever it was cut with.
