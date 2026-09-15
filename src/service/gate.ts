import type { Clock } from "../domain/clock.ts"
import type { CommandResult, CommandRunner } from "../domain/commands.ts"
import type { EventLog, Outcome } from "../domain/events.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { StepResult } from "./attempt.ts"

/** The gate: prove the spec branch after a ticket has landed on it. */
export type RunGate = (run: PreparedRun, ticket: number) => Promise<StepResult>

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
 * What a red gate is *worth* is not settled here: it reports red, and the merge track hands that to
 * the fix service, which spends one fix attempt and then takes the merge back off the branch
 * (ADR-0009).
 */
export const createGateService =
    ({ events, now, prove }: GateDeps): RunGate =>
    async (run, ticket) => {
        const { root, spec } = run

        const record = (outcome: Outcome, detail?: string): Promise<void> =>
            events.append(root, spec, { ticket, step: "gate", outcome, at: now().toISOString(), detail })

        await record("running")

        const proved = await prove(run)
        if (!proved.ok) {
            await record("failed", proved.detail)
            return { outcome: "failed" }
        }

        await record("ok")
        return { outcome: "ok" }
    }
