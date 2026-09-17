import { z } from "zod"
import { usageSchema } from "./agent.ts"

/**
 * The lifecycle event log: the record of what was attempted and how far it got.
 *
 * Two things make it the only state afk keeps. It is append-only — an event is written when a step
 * starts and a second when it ends, and nothing is ever rewritten — so a torn write costs the last
 * line rather than the file. And status is the last event, derived on read and never stored, so two
 * representations of one fact cannot disagree (ADR-0011).
 */

/**
 * Closed by decision. The step is what recovery keys on, which is why adding to this is a deliberate
 * act rather than a convenience (ADR-0011).
 *
 * `setup` is everything an implement attempt does before an agent exists: the claim, the worktree,
 * the environment files and the repository's own setup command. It is a step of its own because it
 * can be killed on its own and because it carries a budget of its own, which is the whole test a
 * member of this enum has to pass (ADR-0022).
 *
 * `plan` and `pull-request` are the steps about the **run** rather than about one ticket's machine,
 * the way `finish` and `skip` are already those actions (ADR-0026). Their events carry no ticket
 * (ADR-0028).
 */
export const STEPS = [
    "plan",
    "setup",
    "implement",
    "prepare",
    "rebase",
    "resolve",
    "merge",
    "gate",
    "fix",
    "revert",
    "pull-request",
] as const

export type Step = (typeof STEPS)[number]

/**
 * The steps a prepare pass can be sent to, and so the steps it has an instruction for. `prepare` is
 * never one of them — a pass is what was sent to the thing that broke, never the thing itself — and
 * neither is `revert`: a ticket being taken back off the spec branch was already on its way out, and
 * putting it back is the one thing recovery must not do (ADR-0009, ADR-0012).
 *
 * `setup` is not one either, and that is a decision rather than an omission: a half-made worktree is
 * thrown away and cut again, which is faster and more certain than anything an agent would do to it
 * (ADR-0024).
 */
export const BROKEN_STEPS = ["implement", "rebase", "resolve", "merge", "gate"] as const

export type BrokenStep = (typeof BROKEN_STEPS)[number]

export const repairableStep = (step: Step): step is BrokenStep => BROKEN_STEPS.some(broken => broken === step)

/**
 * Closed, and it grows only by a deliberate act. The test a member must pass: an outcome names
 * **what the tool distinguished**, never **what afk ascribed** (ADR-0025).
 *
 * `conflicted` passes it — git stops a rebase part-way and says so, and the git port has carried
 * the distinction since before the log did. Only a rebase produces it: a squash cannot conflict,
 * because the ticket was rebased onto that tip and the merge track is serial (ADR-0006), and a
 * revert that conflicts halts the run rather than becoming a state (ADR-0009). A failure's *reason*
 * is still free text in `detail`, which nothing branches on (ADR-0011).
 */
export const OUTCOMES = ["running", "ok", "failed", "skipped", "conflicted"] as const

export type Outcome = (typeof OUTCOMES)[number]

const eventSchema = z.object({
    /**
     * The ticket this happened to, and absent on a run-level step. Every derivation here matches it
     * against a ticket number, so a ticketless event is invisible to all of them — which is the
     * whole reason it may be absent rather than a sentinel (ADR-0028).
     */
    ticket: z.int().positive().optional(),
    step: z.enum(STEPS),
    outcome: z.enum(OUTCOMES),
    /** When it was appended, as an ISO instant. Never branched on. */
    at: z.string().min(1),
    /**
     * The attempt's session, read out of the stream rather than generated: an id here is a session
     * that exists (ADR-0017). It belongs to the attempt, not to the ticket.
     *
     * Absent on a `setup` event, and that is not a hole: setup runs the repository's own commands
     * rather than an agent, and an attempt that never had a session never had one to record.
     */
    sessionId: z.string().optional(),
    /**
     * The commit a step's attempt started from, carried by its start event: the commit a ticket's
     * worktree was cut from by the setup that cut it, and the spec branch's tip a fix agent was let
     * loose on — which is the merge the revert takes back off, fix commits and all (ADR-0009).
     */
    baseSha: z.string().optional(),
    /** Where the attempt's transcript is, relative to the repository root. */
    transcriptPath: z.string().optional(),
    /**
     * Free text: why a step ended as it did, or what an agent wants the reader of a commit to know.
     * There is no closed enum of failure reasons. It is quoted — the conflict resolver's note
     * reaches the squash body this way — but nothing ever branches on it.
     */
    detail: z.string().optional(),
    /**
     * What this attempt consumed, carried by an agent step's end event. It is what makes "which
     * step burns the allowance" a reading rather than an argument, and so what a profile is dialled
     * against (ADR-0027).
     *
     * Absent rather than zero where no agent ran: a step that runs commands holds no session and
     * spends no tokens, and a zero there would read as an agent that used nothing — a different
     * claim, and a bug report rather than the design.
     */
    usage: usageSchema.optional(),
})

export type LifecycleEvent = z.infer<typeof eventSchema>

/**
 * Everything an event carries beyond what every event of its step already carries. One type rather
 * than a copy per service, because which fields may vary is a property of the event and the event
 * is defined here.
 */
export type EventDetails = Pick<LifecycleEvent, "sessionId" | "baseSha" | "transcriptPath" | "detail" | "usage">

/**
 * One line of the log, or nothing. The log is read defensively on purpose: the last line of one a
 * killed run left behind is as likely to be half-written as not, and losing only that line is the
 * whole point of one object per line.
 */
export const readEvent = (raw: unknown): LifecycleEvent | undefined => {
    const parsed = eventSchema.safeParse(raw)
    return parsed.success ? parsed.data : undefined
}

/** Where afk keeps the event log. A driven port: the domain says what it needs, never how. */
export type EventLog = {
    /** Every event for this spec, oldest first. A spec with no log has no events. */
    read: (root: string, spec: number) => Promise<readonly LifecycleEvent[]>
    append: (root: string, spec: number, event: LifecycleEvent) => Promise<void>
}

/**
 * Whether this spec has a run, which is what forbids a mode from starting over one (ADR-0014).
 *
 * A ticket having been attempted, rather than the log file being there: `plan` writes a run-level
 * event before any ticket is touched, so file existence would make `--plan-only` followed by
 * `--implement-only` refuse itself (ADR-0028).
 */
export const started = (events: readonly LifecycleEvent[]): boolean => events.some(event => event.ticket !== undefined)

/** A ticket's status is its last event, and there is nothing else to it (ADR-0011). */
export const statusOf = (events: readonly LifecycleEvent[], ticket: number): LifecycleEvent | undefined =>
    events.findLast(event => event.ticket === ticket)

/**
 * How many times a step has been attempted, counted from its start events. Nothing stores a counter,
 * so nothing can hold one that disagrees with the log.
 */
export const attempts = (events: readonly LifecycleEvent[], ticket: number, step: Step): number =>
    events.filter(event => event.ticket === ticket && event.step === step && event.outcome === "running").length

/** Only the gate produces verified, and a ticket reverted after one stops being verified (ADR-0015). */
export const verified = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return last?.step === "gate" && last.outcome === "ok"
}

/**
 * A ticket whose implementer reported back and whose work has not been taken any further: what the
 * merge track draws from, exactly as the slate draws from verified blockers.
 */
export const implemented = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return last?.step === "implement" && last.outcome === "ok"
}

/**
 * A ticket whose worktree is cut, whose environment is in it and whose dependencies are installed,
 * and that no implementer has had yet. It is what an implement action is handed, and a run killed
 * here keeps that warm worktree rather than paying for it twice (ADR-0022).
 */
export const setUp = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return last?.step === "setup" && last.outcome === "ok"
}

/**
 * The commit a ticket's worktree was cut from, as the setup that cut it recorded it. The implementer
 * is judged against it — what it committed has to sit on top of it — so it is read back from the log
 * rather than asked of git again: the spec branch has moved on since, and the worktree has not.
 */
export const cutFrom = (events: readonly LifecycleEvent[], ticket: number): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.step === "setup" && event.baseSha !== undefined)?.baseSha

/**
 * A ticket squashed onto the spec branch whose gate has not yet run. It is what a run killed between
 * a merge and its gate leaves behind, and the merge track draws from it as readily as from an
 * implemented ticket: the gate runs after every merge without exception, and a process boundary is
 * not an exception (ADR-0008).
 */
export const merged = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return last?.step === "merge" && last.outcome === "ok"
}

/**
 * A ticket whose rebase git stopped part-way: the one state a `resolve` is ever taken out of, and
 * the reason the conflict resolver is never handed a worktree it has no move in (ADR-0025).
 */
export const conflicted = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return last?.step === "rebase" && last.outcome === "conflicted"
}

/**
 * A ticket sitting on the spec branch's tip that has not been landed on it: what the squash draws
 * from, exactly as the merge track draws from an implemented ticket.
 *
 * Two steps produce it and they are one state, because the ticket's work is on the tip either way:
 * a rebase git carried through by itself, and one a conflict resolver finished (ADR-0005).
 */
export const rebased = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return (last?.step === "rebase" || last?.step === "resolve") && last.outcome === "ok"
}

/**
 * What the ticket's conflict resolver said it did, where there was a conflict at all. The note is
 * kept as the resolve event's detail and read back from there, so that a merge landing work an
 * earlier process resolved still quotes it in the squash body (ADR-0007).
 */
export const resolutionNote = (events: readonly LifecycleEvent[], ticket: number): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.step === "resolve" && event.outcome === "ok")?.detail

/** A ticket nothing more will happen to: it failed for good, or it was skipped. */
export const settled = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const outcome = statusOf(events, ticket)?.outcome
    return outcome === "failed" || outcome === "skipped"
}

/**
 * A ticket whose last event says a step began and never ended. Whether that step is *happening* is
 * a question the log cannot answer — only the driver's live action set can (ADR-0019).
 */
export const running = (events: readonly LifecycleEvent[], ticket: number): boolean =>
    statusOf(events, ticket)?.outcome === "running"

/** A ticket the log has never mentioned, which is the only kind a first attempt is handed out for. */
export const unattempted = (events: readonly LifecycleEvent[], ticket: number): boolean =>
    statusOf(events, ticket) === undefined

/**
 * The step a recovery pass is about: the last event that was not itself a prepare.
 *
 * A prepare is never the thing that broke — it is what was sent to the thing that broke — so it is
 * looked past, and a prepare a killed run left `running` is still about whatever it was sent to
 * (ADR-0012).
 */
export const brokenStep = (events: readonly LifecycleEvent[], ticket: number): Step | undefined =>
    events.findLast(event => event.ticket === ticket && event.step !== "prepare")?.step

/**
 * A ticket a prepare pass has been through, and the step it was sent to repair: what the normal
 * track picks the ticket back up by.
 */
export const prepared = (events: readonly LifecycleEvent[], ticket: number): Step | undefined => {
    const last = statusOf(events, ticket)
    return last?.step === "prepare" && last.outcome === "ok" ? brokenStep(events, ticket) : undefined
}

/**
 * What a step's last attempt started from, where it recorded one. The revert reads the fix's: the
 * spec branch's tip before the fix agent committed on it is the merge that has to come off, and
 * reading it back off the log is what lets a revert follow a fix the run that started it did not
 * live to finish (ADR-0009, ADR-0023).
 */
export const baseShaOf = (events: readonly LifecycleEvent[], ticket: number, step: Step): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.step === step && event.baseSha !== undefined)?.baseSha

/**
 * The session a step's last attempt was given, where it was given one at all. An id here was read
 * out of a stream, so continuing it continues a session that exists — which is the whole of why
 * afk never generates one (ADR-0017).
 */
export const sessionOf = (events: readonly LifecycleEvent[], ticket: number, step: Step): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.step === step && event.sessionId !== undefined)?.sessionId

/**
 * What a skip is written down as. The step is `implement`, because implementing is the work that
 * will not happen; the detail says why, and like every detail nothing ever branches on it.
 */
export const skipped = (ticket: number, at: Date): LifecycleEvent => ({
    ticket,
    step: "implement",
    outcome: "skipped",
    at: at.toISOString(),
    detail: "a ticket it is blocked by will not land",
})

/**
 * What a reverted ticket is written down as. The outcome is `failed` because **the ticket** failed —
 * its merge was taken back off the spec branch and it will not land — rather than because the
 * revert did. A revert afk could not perform halts the run, and the detail is where the two are
 * told apart, which is the only place they ever need telling apart: to the schedule they are one
 * thing, a ticket nothing more will happen to (ADR-0009).
 */
export const reverted = (ticket: number, at: Date, detail: string): LifecycleEvent => ({
    ticket,
    step: "revert",
    outcome: "failed",
    at: at.toISOString(),
    detail,
})

export type Progress = {
    /** Tickets whose gate went green. Nothing else proves a ticket landed sound (ADR-0008). */
    verified: readonly number[]
    /** Tickets a step got through that the gate has not proven: implemented, or merged. */
    unverified: readonly number[]
    failed: readonly number[]
    skipped: readonly number[]
}

/** What the log says a run came to, read for the operator rather than for a decision. */
export const progressOf = (tickets: readonly number[], events: readonly LifecycleEvent[]): Progress => {
    const withOutcome = (outcome: Outcome): readonly number[] =>
        tickets.filter(ticket => statusOf(events, ticket)?.outcome === outcome)

    const wentWell = withOutcome("ok")
    return {
        verified: wentWell.filter(ticket => verified(events, ticket)),
        unverified: wentWell.filter(ticket => !verified(events, ticket)),
        failed: withOutcome("failed"),
        skipped: withOutcome("skipped"),
    }
}
