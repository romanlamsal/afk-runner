import { describe, expect, it } from "vitest"
import type { TrunkState } from "../../src/domain/git.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { Mode } from "../../src/domain/mode.ts"
import type { Commands } from "../../src/domain/operator.ts"
import { createStartService, type StartResult } from "../../src/service/start.ts"
import { createFakeGit, type FakeGit } from "../fakes/git.ts"
import { createFakeManifestStore, type FakeManifestStore } from "../fakes/manifest-store.ts"
import { createFakeOperator, type FakeOperator } from "../fakes/operator.ts"
import { createFakeRunRecords, type FakeRunRecords } from "../fakes/run-records.ts"

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

type Setup = {
    mode?: Mode
    consented?: boolean
    /** What the repository looks like: its root, its trunk, whether a worktree can be checked out. */
    repository?: Parameters<typeof createFakeGit>[0]
    /** The manifest already on disk. */
    stored?: Manifest
    events?: boolean
    /** What the operator did with the confirmation screen. */
    answer?: Commands
    aborts?: boolean
    /** What the planner produced, when the mode plans. */
    planned?: Manifest
}

type Harness = {
    start: () => Promise<StartResult>
    git: FakeGit
    manifests: FakeManifestStore
    operator: FakeOperator
    records: FakeRunRecords
    /** The repositories and specs the planner was asked about. */
    planned: { root: string; spec: number }[]
}

const harness = (setup: Setup = {}): Harness => {
    const git = createFakeGit(setup.repository ?? {})
    const manifests = createFakeManifestStore(
        setup.stored === undefined ? undefined : { ok: true, manifest: setup.stored },
    )
    const operator = createFakeOperator(setup.answer, setup.aborts ?? false)
    const records = createFakeRunRecords({ events: setup.events ?? false })
    const planned: { root: string; spec: number }[] = []

    const service = createStartService({
        cwd: "/repo/packages/thing",
        git: git.git,
        manifests: manifests.store,
        operator: operator.operator,
        plan: async (root, spec) => {
            planned.push({ root, spec })
            return { ok: true, manifest: setup.planned ?? MANIFEST }
        },
        records: records.records,
    })

    return {
        git,
        manifests,
        operator,
        records,
        planned,
        start: () =>
            service({ spec: 4, mode: setup.mode ?? "plan-and-implement", consented: setup.consented ?? false }),
    }
}

describe("createStartService", () => {
    it("should refuse when afk was invoked outside a git worktree", async () => {
        // given
        const { start } = harness({ repository: { root: undefined } })

        // when
        const result = await start()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("not a git worktree") })
    })

    it("should plan against the repository's top level rather than the directory it was invoked in", async () => {
        // given
        const { start, planned } = harness()

        // when
        await start()

        // then
        expect(planned).toEqual([{ root: "/repo", spec: 4 }])
    })

    it("should refuse a bare invocation when a run already exists", async () => {
        // given
        const { start } = harness({ events: true, stored: MANIFEST })

        // when
        const result = await start()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("--force-fresh") })
    })

    it("should plan nothing when it refused", async () => {
        // given
        const { start, planned } = harness({ events: true, stored: MANIFEST })

        // when
        await start()

        // then
        expect(planned).toEqual([])
    })

    it("should lay the run directory down before anything is written into it", async () => {
        // given
        const { start, records } = harness({ mode: "plan-only" })

        // when
        await start()

        // then
        expect(records.created).toEqual([{ root: "/repo", spec: 4 }])
    })

    it("should stop at the manifest under --plan-only", async () => {
        // given
        const { start } = harness({ mode: "plan-only" })

        // when
        const result = await start()

        // then
        expect(result).toEqual({ outcome: "planned", manifest: MANIFEST })
    })

    it("should cut no branch under --plan-only", async () => {
        // given
        const { start, git } = harness({ mode: "plan-only" })

        // when
        await start()

        // then
        expect(git.worktrees).toEqual([])
    })

    it("should implement an existing manifest without planning again", async () => {
        // given
        const { start, planned } = harness({ mode: "implement-only", stored: MANIFEST })

        // when
        await start()

        // then
        expect(planned).toEqual([])
    })

    it("should ask the operator nothing under --implement-only", async () => {
        // given
        const { start, operator } = harness({ mode: "implement-only", stored: MANIFEST })

        // when
        await start()

        // then
        expect(operator.screens).toEqual([])
    })

    it("should still report the state of the repository under --implement-only", async () => {
        // given
        const behind: TrunkState = { branch: "main", ahead: 0, behind: 2, compared: true, dirty: false }
        const { start, operator } = harness({ mode: "implement-only", stored: MANIFEST, repository: { trunk: behind } })

        // when
        await start()

        // then
        expect(operator.reported[0]).toEqual([{ kind: "warning", message: expect.stringContaining("behind") }])
    })

    it("should show the planner's commands for confirmation", async () => {
        // given
        const { start, operator } = harness()

        // when
        await start()

        // then
        expect(operator.screens[0]?.commands).toEqual({ setup: "npm ci", verify: "npm run check" })
    })

    it("should run what the operator confirmed rather than what the planner proposed", async () => {
        // given
        const { start } = harness({ answer: { setup: "pnpm i", verify: "pnpm check" } })

        // when
        const result = await start()

        // then
        expect(result).toEqual({
            outcome: "prepared",
            run: expect.objectContaining({ manifest: { ...MANIFEST, setup: "pnpm i", verify: "pnpm check" } }),
        })
    })

    it("should write the edited commands back, so the manifest is what will run", async () => {
        // given
        const { start, manifests } = harness({ answer: { setup: "pnpm i", verify: "pnpm check" } })

        // when
        await start()

        // then
        expect(manifests.written).toEqual([
            { root: "/repo", spec: 4, manifest: { ...MANIFEST, setup: "pnpm i", verify: "pnpm check" } },
        ])
    })

    it("should abort when the operator closed the confirmation", async () => {
        // given
        const { start } = harness({ aborts: true })

        // when
        const result = await start()

        // then
        expect(result).toEqual({ outcome: "aborted" })
    })

    it("should cut no branch when the operator closed the confirmation", async () => {
        // given
        const { start, git } = harness({ aborts: true })

        // when
        await start()

        // then
        expect(git.worktrees).toEqual([])
    })

    it("should cut the spec branch from the local trunk into the gate worktree", async () => {
        // given
        const { start, git } = harness()

        // when
        await start()

        // then
        expect(git.worktrees).toEqual([{ path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" }])
    })

    it("should hand back the prepared run", async () => {
        // given
        const { start } = harness()

        // when
        const result = await start()

        // then
        expect(result).toEqual({
            outcome: "prepared",
            run: {
                root: "/repo",
                spec: 4,
                trunk: "main",
                branch: "afk/4/spec",
                gate: ".afk/4/gate",
                manifest: MANIFEST,
            },
        })
    })

    it("should refuse when the repository names no trunk to cut from", async () => {
        // given
        const { start } = harness({ repository: { trunk: undefined } })

        // when
        const result = await start()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("no trunk") })
    })

    it("should refuse when the gate worktree could not be created", async () => {
        // given
        const { start } = harness({ repository: { checkout: { ok: false, reason: "fatal: is already checked out" } } })

        // when
        const result = await start()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("already checked out") })
    })
})
