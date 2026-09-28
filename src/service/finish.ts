import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import type { EventDetails, EventLog, Outcome, Progress } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { pullRequestWriterPrompt } from "../domain/prompts.ts"
import {
    composeDraftPullRequest,
    composePullRequest,
    noPullRequestReason,
    type PullRequest,
    pullRequestJsonSchema,
    pullRequestMove,
    readPullRequestSummary,
    wholeSpec,
} from "../domain/pull-request.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { Tracker } from "../domain/tracker.ts"
import { attemptWithAgent } from "./attempt.ts"

/** The driving port: end the run with the one pull request its spec has, or with why there is none. */
export type FinishRun = (run: PreparedRun, progress: Progress) => Promise<FinishResult>

export type FinishResult =
    /**
     * The branch is on the remote, and the spec PR was opened, updated, or — a partial spec whose
     * draft the operator closed — left closed. `draft` is the spec not being whole, whichever it was.
     * Merging it is the operator's act.
     */
    | { outcome: "opened" | "updated" | "left"; draft: boolean; url: string | undefined }
    /** Nothing was opened. The reason is the whole of what the operator is told, and it exits non-zero. */
    | { outcome: "failed"; reason: string }

export type FinishDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
    tracker: Tracker
}

const failed = (reason: string): FinishResult => ({ outcome: "failed", reason })

/**
 * The end of a run: push the spec branch, then open the one pull request its spec has or update the
 * one a previous run opened (ADR-0040).
 *
 * Three things it will not do. It opens nothing where the gate proved nothing — an empty change is
 * not something to hand a reviewer. It reports success over neither the push nor the tracker's
 * writes, so a run that exits `0` is one whose pull request exists. And it stops there: merging is
 * the single irreversible act in a whole run, and it stays the operator's.
 *
 * Only a ready pull request has an agent write its prose. A draft is a backup of the spec branch, and
 * a reviewer can act on nothing in it, so its title and body are the script's own.
 */
export const createFinishService =
    ({ agent, events, git, now, tracker }: FinishDeps): FinishRun =>
    async (run, progress) => {
        const { root, spec, manifest } = run
        const tickets = manifest.tickets.map(ticket => ticket.number)

        if (progress.verified.length === 0) {
            return failed(noPullRequestReason(spec, progress))
        }

        const pushed = await git.push(root, run.branch)
        if (!pushed.ok) {
            return failed(`${run.branch} could not be pushed: ${pushed.reason}`)
        }

        const found = await tracker.findPullRequests(root, run.branch)
        if (!found.ok) {
            return failed(`the pull requests for ${run.branch} could not be looked up: ${found.reason}`)
        }

        const whole = wholeSpec(tickets, progress)
        const move = pullRequestMove(found.found, whole)
        if (move.move === "leave") {
            return { outcome: "left", draft: true, url: move.url }
        }

        const pullRequest = whole
            ? await composeReady({ agent, events, now }, run, progress)
            : composeDraftPullRequest({ spec, tickets, progress })

        if (move.move === "update") {
            const updated = await tracker.updatePullRequest(root, {
                number: move.number,
                title: pullRequest.title,
                body: pullRequest.body,
                markAs: move.markAs,
            })
            if (!updated.ok) {
                return failed(`the pull request for ${run.branch} could not be updated: ${updated.reason}`)
            }
            return { outcome: "updated", draft: pullRequest.draft, url: move.url }
        }

        const opened = await tracker.openPullRequest(root, {
            ...pullRequest,
            head: run.branch,
            base: run.base,
        })
        if (!opened.ok) {
            return failed(`the pull request for ${run.branch} could not be opened: ${opened.reason}`)
        }

        return { outcome: "opened", draft: pullRequest.draft, url: opened.url }
    }

/**
 * A ready pull request, its prose written by an agent. The writer failing does not cost the run its
 * pull request: the branch is pushed and the work is verified either way, so a body saying the prose
 * is missing is what the run is worth. It is still written down: the `pull-request` step's end event
 * says the attempt failed while the run carries on, because the log records attempts and not
 * verdicts.
 */
const composeReady = async (
    { agent, events, now }: Pick<FinishDeps, "agent" | "events" | "now">,
    run: PreparedRun,
    progress: Progress,
): Promise<PullRequest> => {
    const { root, spec } = run
    const transcript = transcriptPath(spec, "pull-request", now())

    /**
     * A step about the run, so its events carry no ticket (ADR-0028). It gets a start and an end
     * like every other step, which is what makes the writer's consumption a reading rather than an
     * argument (ADR-0011, ADR-0027).
     */
    const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
        events.append(root, spec, { step: "pull-request", outcome, at: now().toISOString(), ...details })

    // In the gate worktree, because that is where the spec branch is checked out and the writer
    // reads the commits it is writing about (ADR-0006).
    const written = await attemptWithAgent(
        agent,
        {
            prompt: pullRequestWriterPrompt({ spec, branch: run.branch, base: run.base, progress }),
            root,
            cwd: run.gate,
            transcriptPath: transcript,
            resumeSessionId: undefined,
            outputSchema: pullRequestJsonSchema(),
            profile: PROFILES.pullRequestWriter,
        },
        sessionId => record("running", { sessionId, transcriptPath: transcript }),
    )
    const { sessionId, usage } = written

    await record(written.outcome === "ok" ? "ok" : "failed", {
        sessionId,
        transcriptPath: transcript,
        usage,
        detail: written.outcome === "ok" ? undefined : written.detail,
    })

    return composePullRequest({
        spec,
        progress,
        summary: written.outcome === "ok" ? readPullRequestSummary(written.structuredOutput) : undefined,
    })
}
