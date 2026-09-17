import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import { type EventLog, type Outcome, resolutionNote } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import type { PreparedRun } from "../domain/run.ts"
import { mergedTickets, squashMessage } from "../domain/squash.ts"
import type { StepResult } from "./attempt.ts"

/** Land a rebased ticket on the spec branch. */
export type MergeTicket = (run: PreparedRun, action: { ticket: number }) => Promise<StepResult>

export type MergeDeps = {
    events: EventLog
    git: Git
    now: Clock
}

/**
 * The squash, and the trailer cross-check that guards it. That is the whole of it: the rebase and
 * the resolve that may precede it are actions of their own, and so is the gate that follows every
 * merge without exception (ADR-0008, ADR-0026). It holds no sequence, calls no agent, and the
 * driver hands it out one ticket at a time because one worktree owns the branch (ADR-0006).
 *
 * The squash lands in the gate worktree, the spec branch's sole writer. Its body is the
 * implementer's own commit messages and the resolver's note, both read back rather than carried
 * along: the note belongs to the resolve event, and a merge landing work an earlier process
 * resolved must quote it just the same (ADR-0007).
 */
export const createMergeService =
    ({ events, git, now }: MergeDeps): MergeTicket =>
    async (run, { ticket }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)

        const record = (outcome: Outcome, detail?: string): Promise<void> =>
            events.append(root, spec, { ticket, step: "merge", outcome, at: now().toISOString(), detail })

        const failed = async (detail: string): Promise<StepResult> => {
            await record("failed", detail)
            return { outcome: "failed" }
        }

        // The spec branch's own log, queried by the ticket trailer, is the cross-check for what
        // landed: a git fact, checkable from a fresh clone with no state file. It guards the window
        // a run killed between a squash and its event leaves behind — that ticket's work is already
        // on the branch, and squashing it a second time would replay it. It is a cross-check and
        // not a dispatcher: it says whether this ticket's work is there, never which ticket to take
        // (ADR-0011).
        const onSpecBranch = await git.log(root, { rev: run.branch, notIn: run.trunk })

        await record("running")

        if (onSpecBranch === undefined) {
            return failed(`what has landed on ${run.branch} could not be read`)
        }
        if (mergedTickets(spec, onSpecBranch).includes(ticket)) {
            await record("ok", `#${ticket} was already on ${run.branch}`)
            return { outcome: "ok" }
        }

        const commits = await git.log(root, { rev: branch, notIn: run.branch })
        if (commits === undefined) {
            return failed(`what ${branch} carries could not be read, so #${ticket} has no commit body`)
        }

        const message = squashMessage({
            spec,
            ticket,
            title: listed.ticket.title,
            commits,
            note: resolutionNote(await events.read(root, spec), ticket),
        })

        const squashed = await git.squashMerge(root, { path: run.gate, branch, message })
        if (!squashed.ok) {
            return failed(`#${ticket} could not be squashed onto ${run.branch}: ${squashed.reason}`)
        }

        await record("ok")
        return { outcome: "ok" }
    }
