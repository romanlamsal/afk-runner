import { z } from "zod"
import type { FoundPullRequest } from "../domain/pull-request.ts"
import { INVOCATION_TIMEOUT_MS } from "../domain/timeout.ts"
import type { CloseResult, FindResult, OpenResult, Tracker, UpdateResult } from "../domain/tracker.ts"
import { complaint, type Ran, run } from "./process.ts"

/**
 * The tracker port, against the GitHub CLI. It is assumed to be installed and authenticated: that is
 * a precondition on a target repository, documented rather than checked, because a check that
 * guesses produces refusals that are wrong as often as they are right.
 *
 * The claim is one of the two writes a whole run makes (ADR-0013), and it is a collision guard
 * rather than bookkeeping — which is why a failed one halts the run instead of being logged. The
 * pull request is the other, opened or updated, and it is the last thing the run does (ADR-0040).
 */

/** What `gh pr list --json number,url,state,isDraft` prints, one entry per pull request. */
const listedSchema = z.array(
    z.object({
        number: z.number(),
        url: z.string(),
        state: z.enum(["OPEN", "CLOSED", "MERGED"]),
        isDraft: z.boolean(),
    }),
)

const STATES = { OPEN: "open", CLOSED: "closed", MERGED: "merged" } as const

/** gh's listing, or undefined where it printed something that is not one. */
export const readListed = (stdout: string): readonly FoundPullRequest[] | undefined => {
    let raw: unknown
    try {
        raw = JSON.parse(stdout)
    } catch {
        return undefined
    }
    const parsed = listedSchema.safeParse(raw)
    return parsed.success
        ? parsed.data.map(({ number, url, state, isDraft }) => ({ number, url, state: STATES[state], draft: isDraft }))
        : undefined
}

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
        // against the very branch the spec branch was cut from. What that is the manifest records,
        // and it is the repository's default branch only where nobody said otherwise (ADR-0032).
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

    // `--state all` because a closed draft is an answer too: it is the operator saying the backup is
    // not wanted (ADR-0040). gh lists newest first.
    findPullRequests: async (root, head): Promise<FindResult> => {
        const listed = await run(
            "gh",
            ["pr", "list", "--head", head, "--state", "all", "--json", "number,url,state,isDraft"],
            { cwd: root, timeoutMs: INVOCATION_TIMEOUT_MS },
        )
        if (!listed.ok) {
            return { ok: false, reason: complaint(listed) }
        }

        const found = readListed(listed.stdout)
        return found === undefined
            ? { ok: false, reason: `gh printed no pull request listing: ${listed.stdout.trim()}` }
            : { ok: true, found }
    },

    // The base is left alone: a retarget on GitHub is the operator's. The draft flag moves only
    // where it is told to, because `gh pr ready` on a pull request already ready is not something
    // to rely on.
    updatePullRequest: async (root, { number, title, body, markAs }): Promise<UpdateResult> => {
        const edited = await run("gh", ["pr", "edit", String(number), "--title", title, "--body", body], {
            cwd: root,
            timeoutMs: INVOCATION_TIMEOUT_MS,
        })
        if (!edited.ok) {
            return { ok: false, reason: complaint(edited) }
        }
        if (markAs === undefined) {
            return { ok: true }
        }

        const marked = await run("gh", ["pr", "ready", String(number), ...(markAs === "draft" ? ["--undo"] : [])], {
            cwd: root,
            timeoutMs: INVOCATION_TIMEOUT_MS,
        })
        // Said as it is: the rewrite is not taken back, so the operator is told it went through.
        return marked.ok
            ? { ok: true }
            : { ok: false, reason: `its title and body were rewritten, its draft flag was not: ${complaint(marked)}` }
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
