import type { Tracker } from "../domain/tracker.ts"
import { run } from "./process.ts"

/**
 * The tracker port, against the GitHub CLI. It is assumed to be installed and authenticated: that is
 * a precondition on a target repository, documented rather than checked, because a check that
 * guesses produces refusals that are wrong as often as they are right.
 *
 * The claim is one of the two writes a whole run makes (ADR-0013), and it is a collision guard
 * rather than bookkeeping — which is why a failed one halts the run instead of being logged.
 */
export const createGitHubTracker = (): Tracker => ({
    claim: async (root, ticket) => {
        const edited = await run("gh", ["issue", "edit", String(ticket), "--add-assignee", "@me"], { cwd: root })
        if (edited.ok) {
            return { ok: true }
        }
        return { ok: false, reason: edited.stderr === "" ? edited.stdout : edited.stderr }
    },
})
