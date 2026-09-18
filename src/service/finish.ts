import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import type { EventDetails, EventLog, Outcome, Progress } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { pullRequestWriterPrompt } from "../domain/prompts.ts"
import {
    composePullRequest,
    noPullRequestReason,
    pullRequestJsonSchema,
    readPullRequestSummary,
} from "../domain/pull-request.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { Tracker } from "../domain/tracker.ts"
import { attemptWithAgent } from "./attempt.ts"

/** The driving port: end the run with the one pull request it opens, or with why there is none. */
export type FinishRun = (run: PreparedRun, progress: Progress) => Promise<FinishResult>

export type FinishResult =
    /** The branch is on the remote and the pull request is open. Merging it is the operator's act. */
    | { outcome: "opened"; draft: boolean; url: string | undefined }
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
 * The end of a run: push the spec branch, have an agent write the prose, open one pull request.
 *
 * Three things it will not do. It opens nothing where the gate proved nothing — an empty change is
 * not something to hand a reviewer. It reports success over neither the push nor the create, so a
 * run that exits `0` is one whose pull request exists. And it stops there: merging is the single
 * irreversible act in a whole run, and it stays the operator's.
 *
 * The writer failing is not one of those three. The branch is pushed and the work is verified either
 * way, so a body saying the prose is missing is what the run is worth — losing the pull request over
 * a flaky session would not be. It is still written down: the `pull-request` step's end event says
 * the attempt failed while the run carries on, because the log records attempts and not verdicts.
 */
export const createFinishService =
    ({ agent, events, git, now, tracker }: FinishDeps): FinishRun =>
    async (run, progress) => {
        const { root, spec, manifest } = run

        if (progress.verified.length === 0) {
            return failed(noPullRequestReason(spec, progress))
        }

        const pushed = await git.push(root, run.branch)
        if (!pushed.ok) {
            return failed(`${run.branch} could not be pushed: ${pushed.reason}`)
        }

        const transcript = transcriptPath(spec, "pull-request", now())

        /**
         * A step about the run, so its events carry no ticket (ADR-0028). It gets a start and an
         * end like every other step, which is what makes the writer's consumption a reading rather
         * than an argument (ADR-0011, ADR-0027).
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

        const pullRequest = composePullRequest({
            spec,
            tickets: manifest.tickets.map(ticket => ticket.number),
            progress,
            summary: written.outcome === "ok" ? readPullRequestSummary(written.structuredOutput) : undefined,
        })

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
