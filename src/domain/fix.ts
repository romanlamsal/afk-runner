/**
 * What afk asserts about the fix agent's single attempt at a red gate (ADR-0009).
 *
 * Both questions are about the gate worktree — the spec branch's only writer — and both exist to
 * stop the re-gate being asked a question whose answer is already known. A fix nobody committed is
 * proven and then lost; a fix that never happened is a setup and a verify spent on the tree that
 * was red a moment ago.
 *
 * Whether the fix agent honoured its constraint — fix the cause, never the signal — is not asserted
 * here and cannot be: it is a claim about a diff, and the reviewer of the spec PR is who reads it.
 */

export type FixWork = {
    /** Whether the gate worktree has nothing uncommitted left in it. */
    clean: boolean
    /** Whether the spec branch moved, which is the only shape a fix can take. */
    moved: boolean
}

/** What is wrong with what the fix agent left behind, as the lifecycle event's `detail` should say it. */
export const fixerFault = ({ clean, moved }: FixWork): string | undefined => {
    if (!clean) {
        return "the fix agent left work uncommitted in the gate worktree"
    }
    if (!moved) {
        return "the fix agent committed nothing, so the spec branch is exactly as the gate found it"
    }
    return undefined
}
