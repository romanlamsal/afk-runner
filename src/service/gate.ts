import type { Clock } from "../domain/clock.ts"
import type { CommandRunner } from "../domain/commands.ts"
import type { EventLog, Outcome } from "../domain/events.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { StepResult } from "./attempt.ts"

/** The gate: prove the spec branch after a ticket has landed on it. */
export type RunGate = (run: PreparedRun, ticket: number) => Promise<StepResult>

export type GateDeps = {
    /** The operator's own `setup` and `verify`, run in the gate worktree and nowhere else. */
    commands: CommandRunner
    events: EventLog
    now: Clock
}

/**
 * `setup` then `verify`, in the gate worktree — long-lived, re-created at process start, and the
 * spec branch's sole writer, so it already stands on the commit that just landed (ADR-0006).
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
 * What a red gate is *worth* is not settled here. ADR-0009 says one fix attempt, then revert the
 * merge and re-gate the reverted tip, then halt if it is still red; none of that is built yet, so
 * until it is, a red gate simply fails its ticket and the `revert` step stays unused.
 */
export const createGateService =
    ({ commands, events, now }: GateDeps): RunGate =>
    async (run, ticket) => {
        const { root, spec, gate, manifest } = run

        const record = (outcome: Outcome, detail?: string): Promise<void> =>
            events.append(root, spec, { ticket, step: "gate", outcome, at: now().toISOString(), detail })

        await record("running")

        for (const command of [manifest.setup, manifest.verify]) {
            const ran = await commands({ root, cwd: gate, command })
            if (!ran.ok) {
                await record("failed", ran.detail)
                return { outcome: "failed" }
            }
        }

        await record("ok")
        return { outcome: "ok" }
    }
