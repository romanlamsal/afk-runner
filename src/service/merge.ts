import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import { type EventDetails, type EventLog, type Outcome, resolutionNote, type Step } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { resolverPrompt } from "../domain/prompts.ts"
import { readResolutionNote, resolutionJsonSchema, resolverFault } from "../domain/resolution.ts"
import type { PreparedRun } from "../domain/run.ts"
import { mergedTickets, squashMessage } from "../domain/squash.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"
import type { FixRedGate } from "./fix.ts"
import type { RunGate } from "./gate.ts"

/** One ticket through the merge track: rebased onto the spec branch, landed on it, and proven. */
export type MergeTicket = (run: PreparedRun, action: { ticket: number; attempt: number }) => Promise<StepResult>

export type MergeDeps = {
    agent: AgentRunner
    events: EventLog
    /** The gate's driving port: every merge is followed by one, without exception (ADR-0008). */
    gate: RunGate
    git: Git
    now: Clock
    /** What a red gate is worth: one fix attempt, then the revert and the gate again (ADR-0009). */
    fix: FixRedGate
}

/**
 * Land a ticket on the spec branch and prove it: rebase onto the tip, squash onto the branch, gate.
 * It is the only thing that produces a **verified** ticket, and the driver hands it one ticket at a
 * time — serial by correctness, because one worktree owns the branch (ADR-0006).
 *
 * Every ticket is rebased, always, and in the ticket's **own** worktree — the branch is checked out
 * there, and git will not check one branch out twice, so a resolver with a worktree of its own is a
 * path that could never work. It is also the warm one, which is what lets the resolver run the
 * repository's checks on what it produced (ADR-0005).
 *
 * The one rule the script keeps for itself is the abort. The resolver is told never to abort, and
 * this is what happens when it does anyway or gets nowhere: afk aborts, fails the ticket, and
 * leaves the spec branch exactly as it found it — no revert, no gate.
 */
export const createMergeService =
    ({ agent, events, fix, gate, git, now }: MergeDeps): MergeTicket =>
    async (run, { ticket, attempt }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)

        const record = (step: Step, outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, { ...details, ticket, step, outcome, at: now().toISOString() })

        /**
         * The end of a rebase that did not land. The abort is asked for unconditionally because it
         * is a no-op where there is nothing to abort, and because every other way of deciding
         * whether to abort is a second reading of a tree that has already moved.
         */
        const abandon = async (detail: string): Promise<StepResult> => {
            const aborted = await git.abortRebase(root, worktree)
            const reported = aborted.ok ? detail : `${detail}, and the rebase could not be aborted: ${aborted.reason}`
            await record("rebase", "failed", { detail: reported })
            return { outcome: "failed" }
        }

        /**
         * The gate, and what a green one entitles the run to tidy away. A verified ticket's worktree
         * has nothing left to say — its work is on the spec branch — while a failed or a skipped one
         * keeps branch, worktree and transcripts, because that is what a reader and the prepare
         * agent have to go on (ADR-0012).
         *
         * A removal that fails is deliberately not checked and not recorded. It costs disk and
         * nothing else: the ticket's work is on the branch either way, so un-verifying it over a
         * directory would be a lie, and the next `checkoutWorktree` at that path force-removes what
         * is there anyway.
         *
         * A red gate is not the end of the ticket by itself: the fix service spends the one fix
         * attempt on it, and failing that takes the merge back off the branch and gates what is
         * left, so that the blame is demonstrated rather than asserted (ADR-0009). What comes back
         * is the ticket's fate either way.
         */
        const gated = async (): Promise<StepResult> => {
            const proven = await gate(run, ticket)
            const result = proven.outcome === "failed" ? await fix(run, listed.ticket) : proven
            if (result.outcome === "ok") {
                await git.removeWorktree(root, worktree)
            }
            return result
        }

        const failedToMerge = async (detail: string): Promise<StepResult> => {
            await record("merge", "failed", { detail })
            return { outcome: "failed" }
        }

        /**
         * Squash the ticket onto the spec branch, in the gate worktree, which is its sole writer.
         * The body is the implementer's own commit messages and the resolver's note, both read back
         * rather than carried along: the note belongs to the resolve event, and a merge landing work
         * an earlier process resolved must quote it just the same (ADR-0007).
         */
        const land = async (): Promise<StepResult> => {
            await record("merge", "running")

            const commits = await git.log(root, { rev: branch, notIn: run.branch })
            if (commits === undefined) {
                return failedToMerge(`what ${branch} carries could not be read, so #${ticket} has no commit body`)
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
                return failedToMerge(`#${ticket} could not be squashed onto ${run.branch}: ${squashed.reason}`)
            }

            await record("merge", "ok")
            return gated()
        }

        // The spec branch's own log, queried by the ticket trailer, is the cross-check for what
        // landed: a git fact, checkable from a fresh clone with no state file. The decision function
        // hands a merged ticket back to this track so that a run killed between a squash and its
        // gate still gets one (ADR-0008), and that ticket's work is already on the branch — rebasing
        // and squashing it a second time would replay it. It is a cross-check and not a dispatcher:
        // it says whether this ticket's work is there, never which ticket to take (ADR-0011).
        const onSpecBranch = await git.log(root, { rev: run.branch, notIn: run.trunk })
        if (onSpecBranch === undefined) {
            await record("merge", "running")
            return failedToMerge(`what has landed on ${run.branch} could not be read`)
        }
        if (mergedTickets(spec, onSpecBranch).includes(ticket)) {
            await record("merge", "running")
            await record("merge", "ok", { detail: `#${ticket} was already on ${run.branch}` })
            return gated()
        }

        await record("rebase", "running")

        if (!(await git.isClean(root, worktree))) {
            return abandon(`the worktree for #${ticket} is not a clean checkout, and a rebase would bury what is in it`)
        }

        // Read before the rebase, so that a spec branch that names no commit is a repository fault
        // with its own words rather than something the resolver gets blamed for afterwards. Nothing
        // moves it in the meantime: the merge track is serial and the gate worktree is its only
        // writer (ADR-0006).
        const tip = await git.revision(root, run.branch)
        if (tip === undefined) {
            return abandon(`the spec branch ${run.branch} names no commit to rebase #${ticket} onto`)
        }

        const rebased = await git.rebase(root, { path: worktree, onto: run.branch })
        if (rebased.outcome === "failed") {
            return abandon(`#${ticket} could not be rebased onto ${run.branch}: ${rebased.reason}`)
        }
        if (rebased.outcome === "landed") {
            await record("rebase", "ok")
            return land()
        }

        // A rebase git stopped part-way, written down as what git distinguished rather than as a
        // failure (ADR-0025). Nothing routes on it yet — the resolver is called from inside this
        // action, below — but a run killed here leaves a log that says a conflict is what it was
        // killed at, and the reader of the log can see which tickets needed a resolver.
        await record("rebase", "conflicted")

        const transcript = transcriptPath(spec, `t${ticket}-resolve-${attempt}`, now())

        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: resolverPrompt({
                    spec,
                    ticket,
                    title: listed.ticket.title,
                    branch,
                    onto: run.branch,
                    verify: manifest.verify,
                }),
                root,
                cwd: worktree,
                transcriptPath: transcript,
                resumeSessionId: undefined,
                outputSchema: resolutionJsonSchema(),
                profile: PROFILES.resolver,
            },
            sessionId => record("resolve", "running", { sessionId, transcriptPath: transcript }),
        )
        const { sessionId, usage } = attempted

        if (attempted.outcome === "failed") {
            await record("resolve", "failed", {
                sessionId,
                transcriptPath: transcript,
                usage,
                detail: attempted.detail,
            })
            return abandon(`the conflict resolver for #${ticket} failed: ${attempted.detail}`)
        }

        const landed = await git.revision(root, branch)
        const fault = resolverFault({
            conflicted: await git.conflicted(root, worktree),
            onTip: await git.contains(root, { rev: branch, commit: tip }),
            ahead: landed !== undefined && landed !== tip,
        })
        if (fault !== undefined) {
            await record("resolve", "failed", { sessionId, transcriptPath: transcript, usage, detail: fault })
            return abandon(fault)
        }

        // The note is kept as the resolve event's detail, which is where the squash body reads it
        // from: the reasoning belongs to the commit that lands this ticket, not to a log nobody
        // opens. A resolver that reported none leaves none, rather than a sentence afk made up.
        await record("resolve", "ok", {
            sessionId,
            transcriptPath: transcript,
            usage,
            detail: readResolutionNote(attempted.structuredOutput),
        })
        await record("rebase", "ok")
        return land()
    }
