import { INVOCATION_TIMEOUT_MS } from "../domain/timeout.ts"
import type { CloseResult, OpenResult, Tracker } from "../domain/tracker.ts"
import { complaint, type Ran, run } from "./process.ts"

/**
 * The tracker port, against the GitHub CLI. It is assumed to be installed and authenticated: that is
 * a precondition on a target repository, documented rather than checked, because a check that
 * guesses produces refusals that are wrong as often as they are right.
 *
 * The claim is one of the two writes a whole run makes (ADR-0013), and it is a collision guard
 * rather than bookkeeping — which is why a failed one halts the run instead of being logged. The
 * pull request is the other, and it is the last thing the run does.
 */

/**
 * Where gh says the pull request is. The url is the last thing it prints, but it prints notices on
 * the same stream, so the line is recognised rather than counted to: a run that printed a notice
 * where the operator expects a link would be worse than one that printed no link at all.
 */
const printedUrl = (ran: Ran): string | undefined =>
    ran.stdout
        .split("\n")
        .map(line => line.trim())
        .findLast(line => line.startsWith("http"))

export const createGitHubTracker = (): Tracker => ({
    claim: async (root, ticket) => {
        const edited = await run("gh", ["issue", "edit", String(ticket), "--add-assignee", "@me"], { cwd: root })
        return edited.ok ? { ok: true } : { ok: false, reason: complaint(edited) }
    },

    openPullRequest: async (root, { head, base, title, body, draft }): Promise<OpenResult> => {
        // The base is named rather than left to gh to guess, so that the pull request is opened
        // against the very branch the spec branch was cut from. Trunk is what `origin/HEAD` names,
        // which is the repository's default branch (ADR-0018).
        const created = await run(
            "gh",
            [
                "pr",
                "create",
                "--head",
                head,
                "--base",
                base,
                "--title",
                title,
                "--body",
                body,
                ...(draft ? ["--draft"] : []),
            ],
            // The one timeout every external invocation gets. This one reaches the network at the
            // end of an unattended run, where a wedged process is a run that never reports (ADR-0021).
            { cwd: root, timeoutMs: INVOCATION_TIMEOUT_MS },
        )

        return created.ok ? { ok: true, url: printedUrl(created) } : { ok: false, reason: complaint(created) }
    },

    // Asked for rather than attempted: `gh pr close` fails both for a branch that never had a pull
    // request and for one whose pull request is already closed or merged, and neither is a failure
    // to report. What is open is a question gh answers exactly, so it is asked instead of being
    // read out of an error message.
    closePullRequest: async (root, head): Promise<CloseResult> => {
        const listed = await run(
            "gh",
            ["pr", "list", "--head", head, "--state", "open", "--json", "number", "--jq", ".[].number"],
            { cwd: root, timeoutMs: INVOCATION_TIMEOUT_MS },
        )
        if (!listed.ok) {
            return { ok: false, reason: complaint(listed) }
        }

        const [number] = listed.stdout.split("\n").filter(line => line !== "")
        if (number === undefined) {
            return { ok: true, closed: false }
        }

        const closed = await run("gh", ["pr", "close", number], { cwd: root, timeoutMs: INVOCATION_TIMEOUT_MS })
        return closed.ok ? { ok: true, closed: true } : { ok: false, reason: complaint(closed) }
    },
})
