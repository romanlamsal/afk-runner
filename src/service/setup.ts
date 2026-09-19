import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import type { CommandRunner } from "../domain/commands.ts"
import type { CopyEnvironmentFiles } from "../domain/environment.ts"
import type { EventDetails, EventLog, Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { commandLogPath, ticketWorktree } from "../domain/paths.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { Tracker } from "../domain/tracker.ts"
import type { StepResult } from "./attempt.ts"

/** Everything an implement attempt does before an agent exists, as a step of its own (ADR-0022). */
export type SetupTicket = (run: PreparedRun, action: { ticket: number }) => Promise<StepResult>

export type SetupDeps = {
    /** The operator's own `setup`, run in the ticket's worktree before any agent is spawned. */
    commands: CommandRunner
    environment: CopyEnvironmentFiles
    events: EventLog
    git: Git
    now: Clock
    tracker: Tracker
}

/**
 * Make a ticket ready for an implementer: claim it, cut it a worktree from the spec branch's tip,
 * put the operator's environment in it and install what the repository says it needs.
 *
 * **Nothing it does happens before its start event.** That event is written first and the claim is
 * the first act after it, so a ticket that is assigned on the tracker always has a record of the
 * attempt that assigned it — and a run killed anywhere in here leaves `setup: running` rather than
 * silence (ADR-0022).
 *
 * A second of these is a recut rather than a repair: `checkoutWorktree` replaces whatever is at the
 * path, so the attempt differs from the one before it by a fresh worktree and by nothing else
 * (ADR-0024).
 */
export const createSetupService =
    ({ commands, environment, events, git, now, tracker }: SetupDeps): SetupTicket =>
    async (run, { ticket }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)
        const logPath = commandLogPath(spec, `t${ticket}-setup`, now())

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, { ...details, ticket, step: "setup", outcome, at: now().toISOString(), logPath })

        /** A step that got somewhere and stopped: the attempt gets its end event beside its start. */
        const failed = async (detail: string, baseSha?: string): Promise<StepResult> => {
            await record("failed", { baseSha, detail })
            return { outcome: "failed" }
        }

        await record("running")

        // The claim is a collision guard and not bookkeeping, so it is the first thing spent on the
        // ticket, and a refusal stops the run rather than this one step. It is never released: an
        // attempted-and-failed ticket should be findable, and an unassigned one looks untouched.
        // Claiming one already claimed changes nothing, which is what makes a recut harmless here.
        const claim = await tracker.claim(root, ticket)
        if (!claim.ok) {
            return { outcome: "halted", reason: `ticket #${ticket} could not be claimed: ${claim.reason}` }
        }

        const baseSha = await git.revision(root, run.branch)
        if (baseSha === undefined) {
            return failed(`the spec branch ${run.branch} names no commit to cut a worktree from`)
        }

        const checkout = await git.checkoutWorktree(root, { path: worktree, branch, startPoint: baseSha })
        if (!checkout.ok) {
            return failed(`the worktree for #${ticket} could not be created: ${checkout.reason}`, baseSha)
        }

        // Copied rather than symlinked, and before `setup`, which is the first thing that needs them.
        await environment(root, worktree)

        const prepared = await commands({ root, cwd: worktree, command: manifest.setup, logPath })
        if (!prepared.ok) {
            return failed(prepared.detail, baseSha)
        }

        await record("ok", { baseSha })
        return { outcome: "ok" }
    }
