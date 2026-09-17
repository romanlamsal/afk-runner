import {
    attempts,
    type BrokenStep,
    brokenStep,
    conflicted,
    implemented,
    type LifecycleEvent,
    merged,
    mergeSideStep,
    prepared,
    rebased,
    repairableStep,
    running,
    runStepRunning,
    settled,
    setUp,
    statusOf,
    unattempted,
    verified,
} from "./events.ts"
import type { Manifest, Ticket } from "./manifest.ts"
import { slateOrder } from "./schedule.ts"

/**
 * Every scheduling and recovery rule afk has, in one pure function of the manifest, the event log
 * and the run's parameters. The driver races what this returns and re-asks; it holds no rules.
 *
 * Because the decision is read out of the log and nothing else, **resume is not a code path**: a
 * resumed run is this same function called against a non-empty log. There is no mode to get wrong.
 */

export type Action =
    /**
     * Everything an implement attempt does before an agent exists: claim the ticket, cut it a
     * worktree, copy the environment in and run the repository's own setup command. A step of its
     * own because it can be killed on its own and carries a budget of its own (ADR-0022), and one
     * that is never repaired — a second of these throws the worktree away and cuts it again
     * (ADR-0024).
     */
    | { kind: "setup"; ticket: number }
    /** Give a ticket to an implementer. `attempt` is counted from the log, never stored. */
    | { kind: "implement"; ticket: number; attempt: number }
    /**
     * Send the prepare agent to a ticket a step left broken, so that the normal track can pick it
     * back up. `brokenStep` is what it is instructed by — it is never turned loose on a wrecked
     * ticket with no instruction (ADR-0012).
     */
    | { kind: "prepare"; ticket: number; brokenStep: BrokenStep }
    /**
     * Put an implemented ticket onto the spec branch's tip, in the ticket's own worktree — always,
     * and without probing first (ADR-0005). It is the first of the three moves the merge track is
     * made of, and at most one move of that track is ever in flight (ADR-0006).
     */
    | { kind: "rebase"; ticket: number }
    /**
     * Hand a conflict resolver the rebase git stopped part-way. It is given for a `rebase:
     * conflicted` and for nothing else, so that an agent is never turned loose on a worktree with
     * nothing to resolve in it (ADR-0025, ADR-0026).
     *
     * `attempt` is the trip through the merge track it belongs to, counted off the rebase start
     * events — because a resolve spends the rebase's budget rather than one of its own.
     */
    | { kind: "resolve"; ticket: number; attempt: number }
    /**
     * Land a rebased ticket on the spec branch: the squash, and the trailer cross-check that guards
     * the window a run killed between a squash and its event leaves behind. That, and nothing else
     * (ADR-0026).
     */
    | { kind: "merge"; ticket: number }
    /**
     * Prove the spec branch with a ticket's merge on it. It follows every merge without exception,
     * and it is an action of its own so that a run killed between a squash and its gate resumes at
     * the gate rather than at another trip through the merge track (ADR-0008, ADR-0026).
     */
    | { kind: "gate"; ticket: number }
    /**
     * The one attempt a red gate is worth: an agent let loose on the spec branch to mend what the
     * ticket's merge broke. The budget is one, counted off the log's `fix` start events, and what
     * the attempt came to is never taken as the answer — the gate runs again afterwards, because
     * the branch is what afk proves (ADR-0009, ADR-0022).
     */
    | { kind: "fix"; ticket: number }
    /**
     * Take a merge the gate could not prove back off the spec branch, and prove the tip that
     * leaves behind. It is where the gate-red sequence ends: the ticket failed either way, and a
     * tip that is still red halts the run (ADR-0009).
     */
    | { kind: "revert"; ticket: number }
    /** Record that a ticket will not land, because something it is blocked by will not either. */
    | { kind: "skip"; ticket: number }
    /** Nothing is running and nothing more can start. */
    | { kind: "finish" }

export type RunParameters = {
    /**
     * The driver's live action set, passed in — **never derived from events**. A `running` event
     * that is not in here is a step whose process is gone, which is exactly what a killed run
     * leaves behind and what makes resume a derivation rather than a mode.
     */
    inFlight: readonly Action[]
    /** Implementer slots. */
    maxParallel: number
    /** The first interrupt: start nothing new, let what is running finish (ADR-0016). */
    draining: boolean
}

/**
 * What a step gets: the attempt itself, and one more after a prepare pass. A budget rather than a
 * retry policy — the second attempt is different from the first because a prepare agent has been
 * through the ticket in between, and a third would not be (ADR-0012).
 */
const ATTEMPT_BUDGET = 2

/**
 * What a red gate is worth: one fix attempt, and failing that the merge comes back off the branch.
 * A budget rather than a retry policy, and counted off the log's `fix` start events like every
 * other, so that a run killed mid-fix cannot buy a second one (ADR-0009, ADR-0022).
 */
const FIX_BUDGET = 1

const ticketsOf = (actions: readonly Action[]): ReadonlySet<number> =>
    new Set(actions.flatMap(action => ("ticket" in action ? [action.ticket] : [])))

/**
 * Whether an action is one about the spec branch, which is the set seriality is enforced over — and
 * the set the board reads a ticket's track off, so that the two never disagree about what the merge
 * track is.
 */
export const onMergeTrack = (action: Action): boolean =>
    action.kind === "rebase" ||
    action.kind === "resolve" ||
    action.kind === "merge" ||
    action.kind === "gate" ||
    action.kind === "fix" ||
    action.kind === "revert" ||
    (action.kind === "prepare" && mergeSideStep(action.brokenStep))

/**
 * What a prepare pass would be sent to repair on a ticket, or nothing where no pass would help.
 * This is the whole of recovery, and it is the same answer mid-run as on the first tick of a
 * resumed run: the log says a step broke, and the step is what a pass keys on (ADR-0012).
 *
 * A function of the log and a ticket and nothing else, so that anything reading the run — the
 * decision function, and the board that says what a resume is about to do — asks the one rule
 * rather than each deriving its own.
 *
 * A ticket the driver is running is never asked about — a `running` event is only a step whose
 * process is gone once the live action set says so (ADR-0019).
 */
export const repairFor = (events: readonly LifecycleEvent[], ticket: number): BrokenStep | undefined => {
    const last = statusOf(events, ticket)
    const broke = brokenStep(events, ticket)
    if (last === undefined || broke === undefined) {
        return undefined
    }

    // A step nothing ended: a killed run, not a ticket that failed. The attempt was never
    // answered, so the budget — which exists to stop a *failure* repeating — does not apply.
    if (last.outcome === "running") {
        return repairableStep(broke) ? broke : undefined
    }
    // A conflicted rebase is not a step that broke. It is a state of the machine with a move
    // out of it — the resolve — and the same move whether the run that recorded it is still
    // alive or was killed on the spot (ADR-0025, ADR-0026).
    if (last.outcome !== "failed") {
        return undefined
    }

    // Every failed implementer gets the same treatment: classifying them into ones worth a pass
    // and ones that are not is a closed enum of failure reasons in disguise (ADR-0011).
    if (last.step === "implement") {
        return attempts(events, ticket, "implement") < ATTEMPT_BUDGET ? "implement" : undefined
    }
    // A resolve afk could not use ends its rebase, so the two are one budget: what is being
    // spent is the ticket's second trip through the merge track.
    if (last.step === "rebase" || last.step === "resolve") {
        return attempts(events, ticket, "rebase") < ATTEMPT_BUDGET ? last.step : undefined
    }

    return undefined
}

/**
 * What to start now.
 *
 * A ticket is on the slate once every blocker of its is **verified** — merged but not gated does not
 * count — and the slate is handed out most-dependents-first so that starting a blocker late never
 * stalls the pool (ADR-0001).
 *
 * Beside the implement track runs the merge track, and it is serial by correctness rather than by
 * taste: one worktree owns the spec branch, so nothing can land between a ticket's rebase and its
 * merge (ADR-0006).
 */
export const nextActions = (
    manifest: Manifest,
    events: readonly LifecycleEvent[],
    { inFlight, maxParallel, draining }: RunParameters,
): readonly Action[] => {
    const busy = ticketsOf(inFlight)
    const idle = (): readonly Action[] => (inFlight.length === 0 ? [{ kind: "finish" }] : [])

    /**
     * A setup to cut again: one that failed, or one a killed run left `running`, while its own
     * budget still has an attempt in it. The recut is counted like any attempt, so a killed setup
     * that is cut again and killed again fails the ticket (ADR-0024).
     */
    const recutting = (ticket: number): boolean => {
        const last = statusOf(events, ticket)
        return last?.step === "setup" && last.outcome !== "ok" && attempts(events, ticket, "setup") < ATTEMPT_BUDGET
    }

    /**
     * Where a ticket stands in the gate-red sequence, or nothing where it is not in one. The whole
     * of ADR-0009, read off the log rather than held as control flow inside a service: one fix
     * attempt, the gate again on what it left behind, and the revert once the budget is spent
     * (ADR-0023).
     *
     * A fix is never judged by what the fix agent said, and a `fix: running` a killed run left
     * behind is no different: the gate follows all three alike, because the branch is what afk
     * proves. Its start event has already spent the budget, so the sequence carries on to the
     * revert rather than round again — which is why a killed fix cannot buy a second one.
     */
    const afterRedGate = (ticket: number): Action | undefined => {
        const last = statusOf(events, ticket)
        if (last?.step === "fix") {
            return { kind: "gate", ticket }
        }
        if (last?.step === "gate" && last.outcome === "failed") {
            return attempts(events, ticket, "fix") < FIX_BUDGET ? { kind: "fix", ticket } : { kind: "revert", ticket }
        }
        return undefined
    }

    /**
     * A ticket nothing more will happen to: no step of its is live, and no pass, recut or gate-red
     * sequence would take it any further.
     */
    const beyondRepair = (ticket: number): boolean =>
        repairFor(events, ticket) === undefined &&
        !recutting(ticket) &&
        afterRedGate(ticket) === undefined &&
        !busy.has(ticket) &&
        (settled(events, ticket) || running(events, ticket))

    /**
     * The tickets nothing can land any more: the ones beyond repair, and everything blocked by one
     * of those, transitively. A blocker outside the manifest is not this run's work, so it cannot
     * doom anything.
     */
    const dead = new Set(manifest.tickets.map(ticket => ticket.number).filter(beyondRepair))

    for (let spread = true; spread; ) {
        spread = false
        for (const ticket of manifest.tickets) {
            if (!dead.has(ticket.number) && ticket.blockedBy.some(blocker => dead.has(blocker))) {
                dead.add(ticket.number)
                spread = true
            }
        }
    }

    const ofThisRun = new Set(manifest.tickets.map(ticket => ticket.number))

    // ADR-0010: a dependent that was already in flight when its blocker died finishes first and is
    // skipped afterwards, so nothing is skipped out from under a running implementer. A ticket that
    // is beyond repair is never skipped — it has a record of its own, and a skip would overwrite
    // why it died with a sentence about somebody else.
    const skips: Action[] = manifest.tickets
        .filter(ticket => dead.has(ticket.number) && !beyondRepair(ticket.number) && !busy.has(ticket.number))
        .map(ticket => ({ kind: "skip", ticket: ticket.number }))

    const ready = (ticket: Ticket): boolean =>
        ticket.blockedBy.every(blocker => !ofThisRun.has(blocker) || verified(events, blocker))

    /** The tickets a track may act on at all: not already being worked, and not doomed. */
    const actionable = slateOrder(manifest.tickets).filter(
        ticket => !busy.has(ticket.number) && !dead.has(ticket.number),
    )

    // The one thing the merge track would do for this ticket now, or nothing where it has nothing
    // to do. One at a time, and never a doomed ticket: a ticket whose blocker died finishes its
    // implementer and is skipped, rather than spending the merge track on work that cannot land
    // (ADR-0010).
    const mergeSide = (ticket: number): Action | undefined => {
        const repair = repairFor(events, ticket)
        if (repair !== undefined && mergeSideStep(repair)) {
            return { kind: "prepare", ticket, brokenStep: repair }
        }

        const sequence = afterRedGate(ticket)
        if (sequence !== undefined) {
            return sequence
        }

        // The one move out of a conflict, and the only place a conflict resolver is ever called
        // from. A killed run that left the conflict behind gets the same move, because where the
        // ticket is is what the log says and not which process said it (ADR-0025, ADR-0026).
        if (conflicted(events, ticket)) {
            return { kind: "resolve", ticket, attempt: attempts(events, ticket, "rebase") }
        }

        const repaired = prepared(events, ticket)
        // A ticket that landed and was never proven. A run killed between a squash and its gate
        // leaves one, and nothing else would ever dispatch it again — so without this the gate
        // would have an exception, which it does not have (ADR-0008).
        if (merged(events, ticket) || repaired === "gate") {
            return { kind: "gate", ticket }
        }
        // A ticket on the tip, however it got there, and the pass a broken squash earned: both want
        // the squash, and the cross-check inside it is what makes asking twice harmless.
        if (rebased(events, ticket) || repaired === "merge") {
            return { kind: "merge", ticket }
        }
        // The head of the merge track. A pass sent to a rebase or to a resolve comes back here too:
        // what it repaired is a trip through the track, and a trip starts at the rebase.
        if (implemented(events, ticket) || repaired === "rebase" || repaired === "resolve") {
            return { kind: "rebase", ticket }
        }

        return undefined
    }

    // Seriality covers every merge-side action alike — the squash, the gate that follows it, and
    // the prepare pass a broken merge-side step earns: all of them are about the branch one
    // worktree writes, so one of them is the most that ever runs.
    const merges: Action[] = inFlight.some(onMergeTrack)
        ? []
        : actionable.flatMap<Action>(ticket => mergeSide(ticket.number) ?? []).slice(0, 1)

    // A drain starts nothing new, and the gate is not new work: it is the proof of a merge this run
    // has already made, and a drain that left one unproven would put an ungated squash on the spec
    // branch — which is the one exception the gate does not have (ADR-0008, ADR-0016).
    if (draining) {
        const gates = merges.filter(action => action.kind === "gate")
        return gates.length > 0 ? gates : idle()
    }

    const slots = maxParallel - inFlight.filter(action => !onMergeTrack(action)).length
    const starts: Action[] = actionable
        .flatMap<Action>(ticket => {
            const repair = repairFor(events, ticket.number)
            if (repair === "implement") {
                return [{ kind: "prepare", ticket: ticket.number, brokenStep: repair }]
            }
            // A warm worktree gets the implementer it was cut for. The one more attempt the prepare
            // pass bought gets one too, and it works in the worktree it already has.
            const retrying = prepared(events, ticket.number) === "implement"
            if (retrying || setUp(events, ticket.number)) {
                return [
                    {
                        kind: "implement",
                        ticket: ticket.number,
                        attempt: attempts(events, ticket.number, "implement") + 1,
                    },
                ]
            }
            // A first attempt for a ticket the log has never mentioned, and the recut a broken setup
            // earns. Both are a setup, and both take a slot of their own: what they spend is the
            // machine, and the pool is what bounds how much of it runs at once.
            return recutting(ticket.number) || (unattempted(events, ticket.number) && ready(ticket))
                ? [{ kind: "setup", ticket: ticket.number }]
                : []
        })
        .slice(0, Math.max(slots, 0))

    const actions = [...skips, ...merges, ...starts]
    return actions.length > 0 ? actions : idle()
}

/**
 * Whether the log shows a run that has come to its end: the decision function has nothing left to
 * hand out, and no step about the run itself is still going.
 *
 * It is the same question the driver's loop breaks on, asked with nothing in flight — because a
 * follower holds no actions and never will (ADR-0030). That is what makes it safe: every trailing
 * `running` event is a step the schedule still has a move for, so a slow gate, a long implementer
 * and a run killed mid-step all read the same, which is *not concluded*. There is no timeout and no
 * idle threshold here for exactly that reason; a run that is thinking must never look finished.
 *
 * `maxParallel` is one because the answer does not depend on it: slots bound how many starts come
 * back, never whether there are any.
 */
export const concluded = (manifest: Manifest, events: readonly LifecycleEvent[]): boolean =>
    !runStepRunning(events) &&
    nextActions(manifest, events, { inFlight: [], maxParallel: 1, draining: false }).some(
        action => action.kind === "finish",
    )
