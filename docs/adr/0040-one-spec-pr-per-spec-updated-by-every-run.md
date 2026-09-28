---
status: accepted
---

# One spec PR per spec, updated by every run; a draft is a backup

A drained run opened a draft, and the resume that finished the spec then failed at `gh pr create`,
because the draft was already open for the same head. The spec PR was "the one pull request a run
opens", and a spec's resumes are several runs.

**Decision: a spec has one spec PR, and every run that reaches the end pushes the spec branch and
then opens or updates it.** Which, is asked of GitHub every time and never recorded (ADR-0013): an
**open** pull request for the spec branch is updated; with none open, a **whole** spec opens a
ready one — whatever was closed or merged before — and a **partial** spec opens a draft only where
the spec branch has never had a pull request. Whole is every ticket of the manifest verified, and
nothing else: never a reading of the spec issue. The draft flag is set from it on every update.

**A draft is a backup of the spec branch, not something to review.** Without the run directory
beside it (ADR-0013) there is nothing a reviewer can act on, so a draft carries no prose: its title
is `Spec #<n>`, its body a fixed sentence and the manifest's tickets by what they came to, and no
`Closes` lines — a draft cannot be merged, and it is rewritten when it goes ready. The PR writer is
invoked for a ready pull request only, and ADR-0007's composed `Closes` lines are a ready one's.

A draft the operator closed stays closed: a later partial run pushes, opens nothing, and prints the
closed one's link. The exit code describes the spec, not the pull request — `1` for a partial spec
whether a draft was opened, updated or left closed. The base of an existing pull request is left as
it is: a retarget on GitHub is the operator's (ADR-0032 decides it once, at plan time).

## Considered options

- **Record the pull request's number in the log.** Rejected. It is a GitHub fact, and the operator
  can close, merge or retarget it between runs; `gh pr list --head` answers exactly.
- **Replace a closed draft with a new one.** Rejected. Closing it is the operator saying the backup
  is not wanted; only a whole spec is worth reopening over that.
- **Run the writer for drafts too.** Rejected. An agent's session spent on prose nobody reads.

## Consequences

- **Starting over leaves a closed pull request behind** (ADR-0013), and the spec branch's name is
  reused, so every partial run after it finds one and opens no draft. Accepted: a draft is only a
  backup, and a whole spec still opens a ready one.
