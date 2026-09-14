---
status: accepted
---

# Recovery is resume-only, and belongs to the prepare agent

A run is unattended. A resumed run starts from wreckage, and wreckage is judgement, not mechanics.

**Decision: mid-run, a ticket that cannot land is skipped along with its dependents, and the slate
carries on.** Nothing diagnoses, retries cleverly, or waits for a human while nobody is watching.
Repair happens on the next resume, and it is the **prepare agent**'s job — a fifth agent role
alongside the implementer, the conflict resolver, the fix agent and the PR writer.

The prepare agent:

- **runs only on resume**, never mid-run;
- **only ever prepares** — it never merges, never lands work, never touches the spec branch. It
  leaves the ticket in a state the normal track can pick up, and hands back;
- **is instructed by the step that broke.** A ticket stuck at `rebase:failed` needs something
  different looked at than one stuck at `implement:failed`. It is broad by design, because it is the
  out-of-the-ordinary path, but it is never invoked without being told what to check for.

## Considered options

- **Diagnose and repair mid-run.** Rejected. It puts a judgement-heavy agent on the unattended path,
  which is a new failure mode where there was none. Keeping it off that path keeps that path simple.

## Consequences

- Resume dispatches on the last lifecycle event's step (ADR-0011).
- Anything the prepare agent needs must still exist: failed tickets keep their branch, worktree and
  transcript rather than being cleaned up.
