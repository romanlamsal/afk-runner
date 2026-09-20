import { specBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import type { CopyEnvironmentFiles } from "../domain/environment.ts"
import { type EventLog, started } from "../domain/events.ts"
import type { Git, ResetRequest } from "../domain/git.ts"
import { type Holder, heldByAnother, type RunLock, refusalToShare } from "../domain/lock.ts"
import { baseOf, type Manifest, type ManifestStore } from "../domain/manifest.ts"
import type { StartMode } from "../domain/mode.ts"
import type { Commands, ConfirmationScreen, Operator } from "../domain/operator.ts"
import { gateWorktree } from "../domain/paths.ts"
import { baseNotices } from "../domain/preflight.ts"
import { type RunRecordStore, refusalToStart } from "../domain/records.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { PlanSpec } from "./plan.ts"
import type { TakeOver } from "./takeover.ts"

export type StartResult =
    | { outcome: "planned"; manifest: Manifest }
    | { outcome: "prepared"; run: PreparedRun }
    /** The operator closed the confirmation instead of deciding. */
    | { outcome: "aborted" }
    | { outcome: "refused"; reason: string }

export type StartRequest = {
    spec: number
    mode: StartMode
    consented: boolean
    /** `--branch`, already known to name no remote. Whether this checkout has it is asked here. */
    base: string | undefined
}

/** The driving port: get from an accepted invocation to a run that is ready to implement. */
export type StartRun = (request: StartRequest) => Promise<StartResult>

export type StartDeps = {
    /** Where afk was invoked. The target repository is this directory's git top level. */
    cwd: string
    /** The gate runs the operator's own commands, so it needs the operator's own environment. */
    environment: CopyEnvironmentFiles
    git: Git
    now: Clock
    /** One afk per spec: every starting mode takes it (ADR-0036). */
    lock: RunLock
    /** This process, as the lock names it. */
    self: Holder
    manifests: ManifestStore
    operator: Operator
    /** Read to tell a spec with a run from one with only a manifest (ADR-0028). */
    events: EventLog
    /** The plan service's driving port: a bare invocation plans before it prepares. */
    plan: PlanSpec
    records: RunRecordStore
    /** The takeover service's driving port: a live holder is an offer on a terminal (ADR-0035). */
    takeOver: TakeOver
}

const refused = (reason: string): StartResult => ({ outcome: "refused", reason })

/**
 * Implement-only is the mode that does not ask (ADR-0014). The notices print either way: what the
 * operator is told about their repository does not depend on whether they are also being asked
 * something.
 */
const confirmOrReport = async (
    operator: Operator,
    mode: StartMode,
    screen: ConfirmationScreen,
): Promise<Commands | undefined> => {
    if (mode !== "implement-only") {
        return operator.confirm(screen)
    }
    await operator.report(screen.notices)
    return screen.commands
}

/**
 * Put a gate worktree an earlier process left back to the spec branch's tip, rather than throw away
 * the tree an install put there. Whatever it was left holding goes — uncommitted edits and untracked
 * files — so that nothing left behind changes what the gate proves; what is ignored stays. False
 * where there is nothing to reuse: no worktree, or one on another branch.
 */
const reuseWorktree = async (git: Git, root: string, request: ResetRequest): Promise<boolean> =>
    (await git.resetWorktree(root, request)).ok && (await git.cleanWorktree(root, request.path)).ok

/**
 * Starting a run: resolve the repository, refuse what must not continue, lay the run directory down,
 * get a manifest, show the operator where their repository stands, and cut the spec branch into the
 * gate worktree.
 *
 * Every rule it looks like it is applying is the domain's — what a manifest must be, what an existing
 * run forbids, what being behind means. What is left here is the order the ports are called in.
 */
export const createStartService =
    ({
        cwd,
        environment,
        events,
        git,
        now,
        lock,
        self,
        manifests,
        operator,
        plan,
        records,
        takeOver,
    }: StartDeps): StartRun =>
    async ({ spec, mode, consented, base: asked }) => {
        const root = await git.topLevel(cwd)
        if (root === undefined) {
            return refused("this is not a git worktree: run afk from inside the repository whose spec this is")
        }

        const stored = await manifests.read(root, spec)
        const begun = started(await events.read(root, spec))

        // What this spec is already based on, where it has been planned before. Read through `baseOf`
        // and never off the field, so that a manifest written before ADR-0032 answers `main` here
        // exactly as it does everywhere else: an absent field is a base afk already decided, not an
        // open question a second answer may quietly replace.
        const recorded = stored?.ok === true ? baseOf(stored.manifest) : undefined

        /**
         * What the flags and the records forbid, before a holder is considered. Asked as one
         * question so that it can be asked *before* a takeover and reported *after* one: nothing is
         * killed for a start that would refuse anyway, and a live holder is still what the operator
         * hears about first (ADR-0036, ADR-0035).
         *
         * The `--branch` half is both before the run directory exists and before a planner is
         * spawned: a `--branch` afk cannot honour costs a `show-ref` to find out about, and neither
         * a stray directory nor an agent's worth of tokens (ADR-0032).
         */
        const blocking = async (): Promise<string | undefined> => {
            const refusal = refusalToStart({
                spec,
                mode,
                consented,
                records: { manifest: stored !== undefined, started: begun },
            })
            if (refusal !== undefined) {
                return refusal
            }

            if (asked === undefined) {
                return undefined
            }
            if (!(await git.hasLocalBranch(root, asked))) {
                return `--branch ${asked}: this repository has no local branch by that name`
            }

            // The spec branch was cut from what the manifest records, and re-planning cannot re-cut
            // a branch that already exists — so a different name here would move only the pull
            // request's base, away from where the branch actually came from.
            return recorded !== undefined && recorded !== asked
                ? `spec #${spec} is already based on ${recorded}, so --branch ${asked} cannot be honoured. ` +
                      "Pass --force-fresh to plan it afresh"
                : undefined
        }
        const blocked = await blocking()

        // Reported before any other refusal, because every other one would send the operator after
        // the wrong thing: a spec somebody is running is not a spec with the wrong flags (ADR-0036).
        // Taken over or refused, which of the two is the takeover's to say — but never taken over
        // for a start that is going to refuse anyway, which would leave two dead runs (ADR-0035).
        const holder = await lock.holder(root, spec)
        if (heldByAnother(holder, self)) {
            if (blocked !== undefined) {
                return refused(refusalToShare(spec, holder))
            }
            const taken = await takeOver(root, spec, holder)
            if (taken.outcome === "refused") {
                return refused(taken.reason)
            }
        }

        if (blocked !== undefined) {
            return refused(blocked)
        }

        // Before anything is written: the directory ignores itself, so no transcript of the planner's
        // was ever visible in the repository's status.
        await records.create(root, spec)

        // Taken, not just looked at: two starts that both read no holder above race here, and only
        // one of them wins.
        const acquired = await lock.acquire(root, spec, self)
        if (!acquired.ok) {
            return refused(refusalToShare(spec, acquired.holder))
        }

        // The run is ours, and nothing has been dispatched: the first thing the log learns of this
        // process is that it took over from one that is gone. Only a start the flag was needed for is
        // one — `--plan-only` then `--implement-only` is a change of phase, and `--plan-only` over a
        // run resumes nothing (ADR-0037).
        if (begun && consented && mode !== "plan-only") {
            await events.appendBoundary(root, spec, { boundary: "resumption", at: now().toISOString() })
        }

        // Planning a spec that was planned before keeps the base it was planned on: `--plan-only` is
        // the one mode an existing manifest does not stop, and resolving afresh there would rewrite
        // a base the spec branch was already cut from — the drift ADR-0032 records it to prevent.
        const read = mode === "implement-only" ? stored : await plan(root, spec, { base: asked ?? recorded })
        if (read === undefined) {
            return refused(`spec #${spec} has no manifest to implement`)
        }
        if (!read.ok) {
            return refused(read.reason)
        }
        const planned = read.manifest

        if (mode === "plan-only") {
            return { outcome: "planned", manifest: planned }
        }

        // What the manifest records, which under --implement-only is the only place it can come
        // from: that mode does not plan, so nothing has resolved a base this time round (ADR-0032).
        const name = baseOf(planned)
        const base = await git.inspectBase(root, name)
        if (base === undefined) {
            return refused(`spec #${spec} is based on ${name}, and this repository no longer has that branch`)
        }

        const commands = await confirmOrReport(operator, mode, {
            notices: baseNotices(base),
            commands: { setup: planned.setup, verify: planned.verify },
        })
        if (commands === undefined) {
            return { outcome: "aborted" }
        }

        const manifest: Manifest = { ...planned, ...commands }
        if (manifest.setup !== planned.setup || manifest.verify !== planned.verify) {
            await manifests.write(root, spec, manifest)
        }

        const branch = specBranch(spec)
        const gate = gateWorktree(spec)
        if (!(await reuseWorktree(git, root, { path: gate, branch }))) {
            const checkout = await git.checkoutWorktree(root, { path: gate, branch, startPoint: base.branch })
            if (!checkout.ok) {
                return refused(`the gate worktree could not be created: ${checkout.reason}`)
            }
        }
        await environment(root, gate)

        return { outcome: "prepared", run: { root, spec, base: base.branch, branch, gate, manifest } }
    }
