import { specBranch } from "../domain/branches.ts"
import type { CopyEnvironmentFiles } from "../domain/environment.ts"
import { type EventLog, started } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import type { Manifest, ManifestStore } from "../domain/manifest.ts"
import type { StartMode } from "../domain/mode.ts"
import type { Commands, ConfirmationScreen, Operator } from "../domain/operator.ts"
import { gateWorktree } from "../domain/paths.ts"
import { trunkNotices } from "../domain/preflight.ts"
import { type RunRecordStore, refusalToStart } from "../domain/records.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { PlanSpec } from "./plan.ts"

export type StartResult =
    | { outcome: "planned"; manifest: Manifest }
    | { outcome: "prepared"; run: PreparedRun }
    /** The operator closed the confirmation instead of deciding. */
    | { outcome: "aborted" }
    | { outcome: "refused"; reason: string }

export type StartRequest = { spec: number; mode: StartMode; consented: boolean }

/** The driving port: get from an accepted invocation to a run that is ready to implement. */
export type StartRun = (request: StartRequest) => Promise<StartResult>

export type StartDeps = {
    /** Where afk was invoked. The target repository is this directory's git top level. */
    cwd: string
    /** The gate runs the operator's own commands, so it needs the operator's own environment. */
    environment: CopyEnvironmentFiles
    git: Git
    manifests: ManifestStore
    operator: Operator
    /** Read to tell a spec with a run from one with only a manifest (ADR-0028). */
    events: EventLog
    /** The plan service's driving port: a bare invocation plans before it prepares. */
    plan: PlanSpec
    records: RunRecordStore
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
 * Starting a run: resolve the repository, refuse what must not continue, lay the run directory down,
 * get a manifest, show the operator where their repository stands, and cut the spec branch into the
 * gate worktree.
 *
 * Every rule it looks like it is applying is the domain's — what a manifest must be, what an existing
 * run forbids, what being behind means. What is left here is the order the ports are called in.
 */
export const createStartService =
    ({ cwd, environment, events, git, manifests, operator, plan, records }: StartDeps): StartRun =>
    async ({ spec, mode, consented }) => {
        const root = await git.topLevel(cwd)
        if (root === undefined) {
            return refused("this is not a git worktree: run afk from inside the repository whose spec this is")
        }

        const stored = await manifests.read(root, spec)
        const refusal = refusalToStart({
            spec,
            mode,
            consented,
            records: { manifest: stored !== undefined, started: started(await events.read(root, spec)) },
        })
        if (refusal !== undefined) {
            return refused(refusal)
        }

        // Before anything is written: the directory ignores itself, so no transcript of the planner's
        // was ever visible in the repository's status.
        await records.create(root, spec)

        const read = mode === "implement-only" ? stored : await plan(root, spec)
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

        const trunk = await git.inspectTrunk(root)
        if (trunk === undefined) {
            return refused(
                "no trunk to cut the spec branch from: this repository has neither origin/HEAD nor a main or master branch",
            )
        }

        const commands = await confirmOrReport(operator, mode, {
            notices: trunkNotices(trunk),
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
        const checkout = await git.checkoutWorktree(root, { path: gate, branch, startPoint: trunk.branch })
        if (!checkout.ok) {
            return refused(`the gate worktree could not be created: ${checkout.reason}`)
        }
        await environment(root, gate)

        return { outcome: "prepared", run: { root, spec, trunk: trunk.branch, branch, gate, manifest } }
    }
