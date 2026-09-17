import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import { cutFrom, type EventDetails, type EventLog, type Outcome, sessionOf } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { implementerFault } from "../domain/implementer.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { implementerPrompt } from "../domain/prompts.ts"
import type { PreparedRun } from "../domain/run.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"

/** One ticket, from the worktree its setup cut to a settled lifecycle event. */
export type ImplementTicket = (run: PreparedRun, action: { ticket: number; attempt: number }) => Promise<StepResult>

export type ImplementDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
}

/**
 * Give a ticket to an implementer: let an agent commit on a branch of its own, in the worktree the
 * setup step cut for it, and judge what it left there.
 *
 * The claim, the worktree, the environment files and the repository's own setup command are not
 * here: they are the setup step, and by the time this runs they have all happened and been recorded
 * (ADR-0022). What is left is the agent and the two assertions about what it committed.
 *
 * Every rule it looks like it is applying is the domain's — what the implementer is asked, where
 * the worktree is, what counts as work. What is here is the order the ports are called in.
 */
export const createImplementService =
    ({ agent, events, git, now }: ImplementDeps): ImplementTicket =>
    async (run, { ticket, attempt }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)
        const transcript = transcriptPath(spec, `t${ticket}-implement-${attempt}`, now())

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, {
                ...details,
                ticket,
                step: "implement",
                outcome,
                at: now().toISOString(),
                transcriptPath: transcript,
            })

        const log = await events.read(root, spec)

        // What the worktree was cut from, read back from the setup that cut it rather than asked of
        // git again: the implementer is judged against the commit it started from, and the spec
        // branch has moved on since while the worktree has not.
        const baseSha = cutFrom(log, ticket)
        if (baseSha === undefined) {
            await record("running")
            await record("failed", { detail: `the log does not say what #${ticket}'s worktree was cut from` })
            return { outcome: "failed" }
        }

        // The attempt a prepare pass bought continues the session the attempt before it was given,
        // and only where one was recorded: an id in the log was read out of a stream, so it is a
        // session that exists, and a first attempt has none to continue. afk never generates one
        // (ADR-0012, ADR-0017).
        const resumeSessionId = attempt === 1 ? undefined : sessionOf(log, ticket, "implement")

        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: implementerPrompt({
                    spec,
                    ticket,
                    title: listed.ticket.title,
                    branch,
                    verify: manifest.verify,
                }),
                root,
                cwd: worktree,
                transcriptPath: transcript,
                resumeSessionId,
                outputSchema: undefined,
                profile: PROFILES.implementer,
            },
            sessionId => record("running", { sessionId, baseSha }),
        )
        const { sessionId, usage } = attempted

        if (attempted.outcome === "failed") {
            await record("failed", { sessionId, baseSha, usage, detail: attempted.detail })
            return { outcome: "failed" }
        }

        const tip = await git.revision(root, branch)
        const onBase = tip !== undefined && (await git.contains(root, { rev: branch, commit: baseSha }))
        const fault = implementerFault({ baseSha, tip, onBase })
        if (fault !== undefined) {
            await record("failed", { sessionId, baseSha, usage, detail: fault })
            return { outcome: "failed" }
        }

        await record("ok", { sessionId, baseSha, usage })
        return { outcome: "ok" }
    }
