import type { Clock } from "../domain/clock.ts"
import type { CommandResult, CommandRunner } from "../domain/commands.ts"
import type { EventLog, Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree } from "../domain/paths.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { StepResult } from "./attempt.ts"

/** The gate: prove the spec branch after a ticket has landed on it. */
export type RunGate = (run: PreparedRun, action: { ticket: number }) => Promise<StepResult>

/**
 * `setup` then `verify` in the gate worktree, and nothing written down: what proving the spec
 * branch *is*, before anything is said about whose fault the answer is.
 *
 * It is its own driving port because the run asks the question twice for different reasons. The
 * gate asks it about a ticket and records the answer as that ticket's fate; the revert asks it
 * about the branch with that ticket taken back off, where a green is a statement about the ticket
 * that just failed and recording it as a gate would make a reverted ticket read as verified
 * (ADR-0009).
 */
export type ProveBranch = (run: PreparedRun) => Promise<CommandResult>

export type ProveDeps = {
    /** The operator's own `setup` and `verify`, run in the gate worktree and nowhere else. */
    commands: CommandRunner
}

export type GateDeps = {
    events: EventLog
    git: Git
    now: Clock
    prove: ProveBranch
}

export const createProveBranch =
    ({ commands }: ProveDeps): ProveBranch =>
    async run => {
        for (const command of [run.manifest.setup, run.manifest.verify]) {
            const ran = await commands({ root: run.root, cwd: run.gate, command })
            if (!ran.ok) {
                return ran
            }
        }

        return { ok: true, detail: "" }
    }

/**
 * The gate, in the gate worktree — long-lived, re-created at process start, and the spec branch's
 * sole writer, so it already stands on the commit that just landed (ADR-0006).
 *
 * What it asserts is the integrity of **everything merged so far**, which every other check in the
 * run can be green without: two tickets verified in isolation can still fail together. That is why
 * it runs after every merge, without exception, and why `setup` runs unconditionally in front of it
 * rather than when some lockfile appears to have changed (ADR-0008).
 *
 * A green gate is the only thing that produces **verified**, and the ticket it is recorded against
 * is the one whose merge caused the result — which is what lets a red gate name one merge rather
 * than eight suspects.
 *
 * It is an action of its own, given for a ticket whose merge landed and was never proven, so that a
 * run killed between a squash and its gate resumes at the gate rather than at the merge (ADR-0026).
 *
 * What a red gate is worth is not decided here. The gate records what it found and stops; the fix
 * attempt, the gate that follows it and the revert that ends the sequence are actions the decision
 * function gives out of the log (ADR-0009, ADR-0023).
 */
export const createGateService =
    ({ events, git, now, prove }: GateDeps): RunGate =>
    async (run, { ticket }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const record = (outcome: Outcome, detail?: string): Promise<void> =>
            events.append(root, spec, { ticket, step: "gate", outcome, at: now().toISOString(), detail })

        /**
         * What a green entitles the run to tidy away. A verified ticket's worktree has nothing left
         * to say — its work is on the spec branch — while a failed or a skipped one keeps branch,
         * worktree and transcripts, because that is what a reader and the prepare agent have to go
         * on (ADR-0012).
         *
         * A removal that fails is deliberately not checked and not recorded. It costs disk and
         * nothing else: the ticket's work is on the branch either way, so un-verifying it over a
         * directory would be a lie, and the next `checkoutWorktree` at that path force-removes what
         * is there anyway.
         */
        const green = async (): Promise<StepResult> => {
            await git.removeWorktree(root, ticketWorktree(spec, ticket))
            return { outcome: "ok" }
        }

        await record("running")

        const proved = await prove(run)
        if (!proved.ok) {
            await record("failed", proved.detail)
            // A red gate is not the end of the ticket by itself, and it is not this service's
            // business what it is worth: the log says the gate went red, and the decision function
            // reads the sequence out of it (ADR-0009, ADR-0023).
            return { outcome: "failed" }
        }

        await record("ok")
        return green()
    }
