import type { Clock } from "../domain/clock.ts"
import { baseShaOf, type EventLog, type LifecycleEvent, reverted } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import type { PreparedRun } from "../domain/run.ts"
import { revertMessage } from "../domain/squash.ts"
import type { StepResult } from "./attempt.ts"
import type { ProveBranch } from "./gate.ts"

/** Take a merge the gate could not prove back off the spec branch, and prove what that leaves. */
export type RevertTicket = (run: PreparedRun, action: { ticket: number }) => Promise<StepResult>

export type RevertDeps = {
    events: EventLog
    git: Git
    now: Clock
    /** `setup` then `verify`, unrecorded: the reverted tip is proven, not gated (ADR-0009). */
    prove: ProveBranch
}

/**
 * The end of the gate-red sequence: the merge comes off the branch, and the tip it leaves behind is
 * proven (ADR-0009).
 *
 * That last part is what makes the design's claim honest. Without it afk would revert every ticket
 * in turn against a branch that was already broken, blaming each in sequence; with it, a green on
 * the reverted tip *demonstrates* that this merge was the cause, and a red says the branch is broken
 * independently of any ticket and nothing above it is worth continuing.
 *
 * Every path out of here leaves the ticket failed. A revert afk could not perform and a branch that
 * is red without the ticket halt the run as well, and the detail is what tells the three apart —
 * which is the only place they ever need telling apart: to the schedule they are one thing, a ticket
 * nothing more will happen to.
 */
export const createRevertService =
    ({ events, git, now, prove }: RevertDeps): RevertTicket =>
    async (run, { ticket }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const record = (event: LifecycleEvent): Promise<void> => events.append(root, spec, event)

        /**
         * The run cannot go on, and the ticket is settled on the way out: a drain that waits on a
         * ticket nothing will happen to would never end.
         */
        const halt = async (reason: string, detail: string = reason): Promise<StepResult> => {
            await record(reverted(ticket, now(), detail))
            return { outcome: "halted", reason }
        }

        // What the ticket landed as, read back off the fix's start event: the spec branch's tip
        // before the fix agent was let loose on it. Everything from there to the tip is undone, so
        // the squash and whatever the fix committed on top of it go together and the tip left
        // behind is the tree that was green before the ticket merged (ADR-0009).
        const landed = baseShaOf(await events.read(root, spec), ticket, "fix")

        await record({ ticket, step: "revert", outcome: "running", at: now().toISOString() })

        if (landed === undefined) {
            return halt(`the merge of #${ticket} could not be found on ${run.branch} to revert`)
        }

        const undone = await git.revert(root, {
            path: run.gate,
            from: landed,
            message: revertMessage({ spec, ticket, title: listed.ticket.title }),
        })
        if (!undone.ok) {
            return halt(`the merge of #${ticket} could not be reverted off ${run.branch}: ${undone.reason}`)
        }

        const proved = await prove(run)
        if (!proved.ok) {
            const reason = `${run.branch} is broken independently of any ticket: it is still red with #${ticket} reverted off it`
            return halt(reason, `${reason}: ${proved.detail}`)
        }

        await record(
            reverted(ticket, now(), `the gate was green once #${ticket} was reverted, so its merge was the cause`),
        )
        return { outcome: "failed" }
    }
