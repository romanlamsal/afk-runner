/**
 * Every prompt afk sends, composed here as a pure function of what the run knows. Prompts are not
 * asserted for shape: a test over wording pins the wording rather than the behaviour.
 */

/**
 * The planner recovers what the repository already recorded — which issues are the spec's tickets,
 * how they block each other, and how the repository is set up and checked. It decides nothing about
 * scope or granularity: those were decided when the spec was ticketed (ADR-0002, ADR-0003).
 */
export const plannerPrompt = (spec: number): string =>
    [
        `Produce the implementation manifest for spec issue #${spec} in this repository.`,
        "",
        "Read, do not plan. Scope, granularity and dependency edges were decided when the spec was",
        "ticketed. Your job is to recover them and to state how this repository is prepared and",
        "checked.",
        "",
        "Steps:",
        "1. Read this repository's own documentation of its conventions before anything else —",
        "   how it records that an issue belongs to a spec, how it records that one issue blocks",
        "   another, and what its triage labels mean. Its conventions win over any you know.",
        `2. Find the issues that belong to #${spec} by those conventions. Native sub-issues are one`,
        "   convention among several: a task list in the spec's body and a reference line in each",
        "   ticket's body are just as common. Do not assume which one this repository uses.",
        "3. Consider only the tickets that are still open, and drop any whose labels mark it as work",
        "   an agent must not take.",
        "4. Recover each remaining ticket's blockers by the same conventions, and keep only the ones",
        "   that are themselves tickets of this spec. A ticket stating none is blocked by nothing.",
        "5. Derive two commands from this repository itself — its package manifest, its scripts, its",
        "   continuous integration configuration: `setup`, which prepares a fresh checkout for use,",
        "   and `verify`, which proves a checkout's integrity. Both run unattended from the",
        "   repository root: no watch mode, no prompt, no flag that needs a terminal.",
        "",
        "Report the manifest as structured output and nothing else. Change no file, and write",
        "nothing to the issue tracker.",
    ].join("\n")

/**
 * The implementer. It works in a worktree of its own, on a branch of its own, and the one thing it
 * must do beyond the ticket is run `verify` on its own work before it reports — the cheap place to
 * catch work that does not build, rather than the serial merge track (ADR-0015).
 *
 * It is told nothing about the spec branch, because it never touches one: afk rebases and merges.
 */
export const implementerPrompt = ({
    spec,
    ticket,
    title,
    branch,
    verify,
}: {
    spec: number
    ticket: number
    title: string
    branch: string
    verify: string
}): string =>
    [
        `Implement ticket #${ticket} of spec #${spec}: ${title}.`,
        "",
        `You are in a worktree of your own, checked out on ${branch}. Read the ticket and the spec`,
        "issue, and read this repository's own documentation of how it wants code and tests written",
        "before you write any.",
        "",
        "Then:",
        `1. Implement the ticket, and commit your work on ${branch}. Several commits are fine.`,
        `2. Run \`${verify}\` and act on what it says. Fix what you broke, and commit the fix.`,
        "3. Report what you did.",
        "",
        `Only report success once \`${verify}\` is green. Commit everything you want kept: work that`,
        "is not committed does not exist as far as the rest of the run is concerned.",
        "",
        `Stay on ${branch}: do not merge, do not rebase, do not push, and do not touch another`,
        "branch or another worktree. Write nothing to the issue tracker.",
    ].join("\n")

/**
 * The conflict resolver. It is invoked in the ticket's own worktree, mid-rebase, which is both the
 * only worktree the branch can be checked out in and the warm one — so it can run the repository's
 * own checks on what it produced instead of resolving blind (ADR-0005).
 *
 * It is told not to abort, because aborting is the script's to do: an agent that aborts leaves a
 * tree that looks exactly like one that never conflicted.
 */
export const resolverPrompt = ({
    spec,
    ticket,
    title,
    branch,
    onto,
    verify,
}: {
    spec: number
    ticket: number
    title: string
    branch: string
    onto: string
    verify: string
}): string =>
    [
        `A rebase of ${branch} onto ${onto} has stopped on a conflict. The branch carries ticket`,
        `#${ticket} of spec #${spec}: ${title}.`,
        "",
        "You are in that branch's own worktree, with the rebase in progress. Resolve it:",
        "",
        "1. Read both sides of every conflict and work out what each was trying to do. Keep both",
        "   intentions where they can coexist; where they cannot, say so in your note.",
        `2. Stage what you resolved and continue the rebase, until no conflict is left.`,
        `3. Run \`${verify}\` on the result and fix what the resolution broke. Amend or commit as`,
        "   the rebase needs.",
        "",
        "Never abort the rebase, never reset, and never drop either side's work to make the conflict",
        "go away — if you cannot resolve it, stop and say why. Stay in this worktree, touch no other",
        `branch, do not push, and write nothing to the issue tracker.`,
        "",
        "Report a note saying what was in conflict and how you resolved it. It goes into the commit",
        "that lands this ticket, so write it for whoever reads that commit.",
    ].join("\n")
