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
