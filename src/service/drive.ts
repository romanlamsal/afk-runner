import type { Clock } from "../domain/clock.ts"
import { type Action, nextActions } from "../domain/decide.ts"
import { type EventLog, type Progress, progressOf, skipped } from "../domain/events.ts"
import type { Interrupts } from "../domain/interrupts.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { StepResult } from "./attempt.ts"
import type { RunGate } from "./gate.ts"
import type { ImplementTicket } from "./implement.ts"
import type { MergeTicket } from "./merge.ts"
import type { PrepareTicket } from "./prepare.ts"

/** The driving port of a run: work the slate until nothing is left to start and nothing is running. */
export type DriveRun = (run: PreparedRun, options: { maxParallel: number }) => Promise<DriveResult>

export type DriveResult = {
    /**
     * `halted` names a run that stopped itself; the reason is the operator's whole explanation.
     * `interrupted` names one the operator stopped, which is a partial run like any other: it
     * drained what was in flight, and what that landed still becomes a pull request (ADR-0016).
     */
    outcome: "done" | "interrupted" | "halted"
    reason: string | undefined
    progress: Progress
}

export type DriveDeps = {
    events: EventLog
    /** The gate, which follows every merge and is asked for as an action of its own (ADR-0008). */
    gate: RunGate
    implement: ImplementTicket
    /** The operator's stop signal, read once per pass — never trapped by a step (ADR-0016). */
    interrupts: Interrupts
    merge: MergeTicket
    /** The pass a ticket a step left broken gets, mid-run and on a resumed run alike (ADR-0012). */
    prepare: PrepareTicket
    now: Clock
}

type Settled = { action: Action; result: StepResult }

/**
 * The loop, and deliberately nothing else: ask the decision function what to start, start it, wait
 * for one thing to settle, ask again. Every rule about *what* to start is in `nextActions`, which
 * is why this can be read in one sitting and why resume needs no code here — a resumed run is this
 * same loop over a log that is not empty.
 *
 * The one thing the loop owns is `inFlight`: the live action set, passed to the decision function
 * rather than derived from events, which is what makes a `running` event with no process behind it
 * recognisable at all.
 */
export const createDriveService =
    ({ events, gate, implement, interrupts, merge, now, prepare }: DriveDeps): DriveRun =>
    async (run, { maxParallel }) => {
        const { root, spec, manifest } = run
        const inFlight = new Map<Action, Promise<Settled>>()
        let halt: string | undefined

        for (;;) {
            const log = await events.read(root, spec)
            const actions = nextActions(manifest, log, {
                inFlight: [...inFlight.keys()],
                maxParallel,
                // Two things drain, for one reason: nothing new starts, and what is running
                // finishes and records. The run stopping itself, and the operator stopping it.
                draining: halt !== undefined || interrupts.draining(),
            })

            if (actions.some(action => action.kind === "finish")) {
                break
            }

            // A skip is settled by writing it down, so it is recorded and then re-planned rather
            // than raced — the tickets it dooms in turn are the next pass's answer. What a skip
            // reads as in the log is the domain's to say, not this loop's.
            const skips = actions.filter(action => action.kind === "skip")
            if (skips.length > 0) {
                for (const skip of skips) {
                    await events.append(root, spec, skipped(skip.ticket, now()))
                }
                continue
            }

            // Which service serves which action is all this knows about them. That at most one
            // merge is ever handed out is the decision function's rule, not a lock held here
            // (ADR-0006).
            for (const action of actions) {
                if (action.kind === "implement") {
                    inFlight.set(
                        action,
                        implement(run, action).then(result => ({ action, result })),
                    )
                }
                if (action.kind === "merge") {
                    inFlight.set(
                        action,
                        merge(run, action).then(result => ({ action, result })),
                    )
                }
                if (action.kind === "gate") {
                    inFlight.set(
                        action,
                        gate(run, action).then(result => ({ action, result })),
                    )
                }
                if (action.kind === "prepare") {
                    inFlight.set(
                        action,
                        prepare(run, action).then(result => ({ action, result })),
                    )
                }
            }

            // Unreachable: the decision function emits `finish` whenever nothing is in flight and
            // nothing can start. Racing an empty set would hang, so this is a guard, not a rule.
            if (inFlight.size === 0) {
                break
            }

            const settled = await Promise.race(inFlight.values())
            inFlight.delete(settled.action)
            if (settled.result.outcome === "halted" && halt === undefined) {
                halt = settled.result.reason
            }
        }

        const progress = progressOf(
            manifest.tickets.map(ticket => ticket.number),
            await events.read(root, spec),
        )
        // A run that halted itself says so first: it is the one with something to explain, and an
        // interrupt that arrived after it changes nothing about what stopped the run.
        const outcome = (): DriveResult["outcome"] => {
            if (halt !== undefined) {
                return "halted"
            }
            return interrupts.draining() ? "interrupted" : "done"
        }
        return { outcome: outcome(), reason: halt, progress }
    }
