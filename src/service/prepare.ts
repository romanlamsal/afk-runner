import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import { attempts, type BrokenStep, type EventDetails, type EventLog, type Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { preparerPrompt } from "../domain/prompts.ts"
import type { PreparedRun } from "../domain/run.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"

/** The one pass a wrecked ticket gets before the normal track picks it back up (ADR-0012). */
export type PrepareTicket = (
    run: PreparedRun,
    action: { ticket: number; brokenStep: BrokenStep },
) => Promise<StepResult>

export type PrepareDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
}

/**
 * Send the prepare agent to a ticket a step left broken: a failed implementer, or any step whose
 * process a killed run left behind. It is the same pass in both cases, because the log cannot tell
 * them apart and a ticket does not care which one wrecked it (ADR-0012, ADR-0019).
 *
 * What the pass is *for* is the domain's — which step broke, what the agent is told about it, and
 * that the attempt after it is the last one. What is here is the order the ports are called in.
 *
 * It runs in the ticket's own worktree and nowhere else. That is the only tree the agent may write
 * to, and it is where everything a reader of a failed ticket has to go on already is.
 */
export const createPrepareService =
    ({ agent, events, git, now }: PrepareDeps): PrepareTicket =>
    async (run, { ticket, brokenStep }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)
        const attempt = attempts(await events.read(root, spec), ticket, "prepare") + 1
        const transcript = transcriptPath(spec, `t${ticket}-prepare-${attempt}`, now())

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, { ...details, ticket, step: "prepare", outcome, at: now().toISOString() })

        // A ticket whose worktree was never made, or whose worktree a failed start never got as far
        // as, has nothing in it to prepare — and the implementer's own start cuts a fresh one. The
        // pass still gets both its events, because the retry it entitles the ticket to is read off
        // them (ADR-0011).
        if (!(await git.hasWorktree(root, worktree))) {
            await record("running")
            await record("ok", { detail: `#${ticket} has no worktree, so there was nothing to prepare` })
            return { outcome: "ok" }
        }

        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: preparerPrompt({ spec, ticket, title: listed.ticket.title, branch, worktree, brokenStep }),
                root,
                cwd: worktree,
                transcriptPath: transcript,
                // A fresh session: the prepare agent is a role of its own, and the session worth
                // continuing is the one the step that broke was given (ADR-0017).
                resumeSessionId: undefined,
                outputSchema: undefined,
                profile: PROFILES.preparer,
            },
            sessionId => record("running", { sessionId, transcriptPath: transcript }),
        )
        const { sessionId, usage } = attempted

        if (attempted.outcome === "failed") {
            await record("failed", { sessionId, transcriptPath: transcript, usage, detail: attempted.detail })
            return { outcome: "failed" }
        }

        await record("ok", { sessionId, transcriptPath: transcript, usage })
        return { outcome: "ok" }
    }
