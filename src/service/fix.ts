import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import { type EventLog, type LifecycleEvent, reverted, statusOf } from "../domain/events.ts"
import { fixerFault } from "../domain/fix.ts"
import type { Git } from "../domain/git.ts"
import type { Ticket } from "../domain/manifest.ts"
import { transcriptPath } from "../domain/paths.ts"
import { fixerPrompt } from "../domain/prompts.ts"
import type { PreparedRun } from "../domain/run.ts"
import { revertMessage } from "../domain/squash.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"
import type { ProveBranch } from "./gate.ts"

/** What a red gate is worth: one fix attempt, and failing that the merge comes back off the branch. */
export type FixRedGate = (run: PreparedRun, ticket: Ticket) => Promise<StepResult>

export type FixDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
    /** `setup` then `verify`, unrecorded: the reverted tip is proven, not gated (ADR-0009). */
    prove: ProveBranch
}

/**
 * The red gate's recovery, and the whole of ADR-0009: one fix attempt under a hard constraint, then
 * the revert, then proving what the revert left behind.
 *
 * The last of those three is what makes the design's claim honest. Without it afk would revert
 * every ticket in turn against a branch that was already broken, blaming each in sequence; with it,
 * a green on the reverted tip *demonstrates* that this merge was the cause, and a red says the
 * branch is broken independently of any ticket and nothing above it is worth continuing.
 *
 * The fix gets exactly one attempt. That is a budget rather than a retry policy, which is why there
 * is no loop here to bound: this is called once, by the merge track, for one red gate.
 */
export const createFixService =
    ({ agent, events, git, now, prove }: FixDeps): FixRedGate =>
    async (run, { number: ticket, title }) => {
        const { root, spec, manifest } = run

        const record = (event: LifecycleEvent): Promise<void> => events.append(root, spec, event)

        /**
         * The fix attempt's own two events. The step is `gate`, because a second gate is what is
         * being attempted — the closed step enum is what recovery keys on, and a fix is not
         * something recovery keys on (ADR-0011).
         */
        const fixAttempt = (
            outcome: "running" | "ok" | "failed",
            details: Pick<LifecycleEvent, "sessionId" | "transcriptPath" | "detail"> = {},
        ): Promise<void> => record({ ticket, step: "gate", outcome, at: now().toISOString(), ...details })

        // The commit the ticket landed as is the spec branch's tip, because the merge track is
        // serial and the gate worktree is the branch's sole writer: nothing can have landed after
        // it (ADR-0006). It is read *now*, before the fix agent commits on top of it, and whatever
        // the fix agent adds is undone along with it.
        const landed = await git.revision(root, run.branch)

        /**
         * The run cannot go on, and the ticket is settled on the way out: a drain that waits on a
         * ticket nothing will happen to would never end.
         */
        const halt = async (reason: string, detail: string = reason): Promise<StepResult> => {
            await record(reverted(ticket, now(), detail))
            return { outcome: "halted", reason }
        }

        /**
         * Take the merge back off the branch, and then prove the tip it leaves behind. Every path
         * out of here leaves the ticket failed — a revert afk could not perform and a branch that
         * is red without the ticket both halt the run as well, and the detail is what tells the
         * three apart.
         */
        const revert = async (): Promise<StepResult> => {
            await record({ ticket, step: "revert", outcome: "running", at: now().toISOString() })

            if (landed === undefined) {
                return halt(`the merge of #${ticket} could not be found on ${run.branch} to revert`)
            }

            const undone = await git.revert(root, {
                path: run.gate,
                from: landed,
                message: revertMessage({ spec, ticket, title }),
            })
            if (!undone.ok) {
                return halt(`the merge of #${ticket} could not be reverted off ${run.branch}: ${undone.reason}`)
            }

            const proved = await prove(run)
            if (!proved.ok) {
                const said = `${run.branch} is broken independently of any ticket: it is still red with #${ticket} reverted off it`
                return halt(said, `${said}: ${proved.detail}`)
            }

            await record(
                reverted(ticket, now(), `the gate was green once #${ticket} was reverted, so its merge was the cause`),
            )
            return { outcome: "failed" }
        }

        // One attempt, and never a second, so the transcript is named for the only one there is.
        const transcript = transcriptPath(spec, `t${ticket}-fix-1`, now())
        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: fixerPrompt({
                    spec,
                    ticket,
                    title,
                    branch: run.branch,
                    verify: manifest.verify,
                    // What the gate said when it went red, quoted for the agent that has to
                    // reproduce it. It is read back off the log rather than carried along, and like
                    // every detail nothing branches on it.
                    detail: statusOf(await events.read(root, spec), ticket)?.detail,
                }),
                root,
                cwd: run.gate,
                transcriptPath: transcript,
                resumeSessionId: undefined,
                outputSchema: undefined,
            },
            sessionId => fixAttempt("running", { sessionId, transcriptPath: transcript }),
        )
        const { sessionId } = attempted

        /**
         * An attempt the agent itself reported as failed. It is not the question the gate asks —
         * a session that died after committing a fix that works leaves a green branch, and the
         * branch is what afk proves — so it is carried as words rather than branched on, and only
         * reaches the log where the attempt came to nothing anyway (ADR-0009).
         */
        const failure =
            attempted.outcome === "failed" ? `the fix agent for #${ticket} failed: ${attempted.detail}` : undefined

        const said = (detail: string): Promise<void> =>
            fixAttempt("failed", {
                sessionId,
                transcriptPath: transcript,
                detail: failure === undefined ? detail : `${failure}, and ${detail}`,
            })

        const fault = fixerFault({
            clean: await git.isClean(root, run.gate),
            moved: (await git.revision(root, run.branch)) !== landed,
        })
        if (fault !== undefined) {
            await said(fault)
            return revert()
        }

        const proved = await prove(run)
        if (!proved.ok) {
            await said(proved.detail)
            return revert()
        }

        await fixAttempt("ok", { sessionId, transcriptPath: transcript })
        return { outcome: "ok" }
    }
