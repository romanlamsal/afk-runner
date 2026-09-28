import { describe, expect, it } from "vitest"
import { EXIT } from "../../src/cli/exit-codes.ts"
import type { Invocation } from "../../src/cli/invocation.ts"
import { createRun } from "../../src/cli/run.ts"
import type { Progress } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { Mode } from "../../src/domain/mode.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { AfkonfigResult } from "../../src/service/afkonfig.ts"
import type { DriveResult } from "../../src/service/drive.ts"
import type { FinishResult } from "../../src/service/finish.ts"
import type { FreshResult } from "../../src/service/fresh.ts"
import type { StartRequest, StartResult } from "../../src/service/start.ts"
import { createStubShowBoard } from "../fakes/show-board.ts"

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

const PREPARED: PreparedRun = {
    root: "/repo",
    spec: 4,
    base: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

const invocation = (mode: Mode, overrides: Partial<Invocation> = {}): Invocation => ({
    spec: 4,
    mode,
    consented: false,
    forceFresh: false,
    base: undefined,
    maxParallel: 3,
    warnings: [],
    ...overrides,
})

const NOTHING: Progress = { verified: [], unverified: [], failed: [], skipped: [] }

const WORKED: DriveResult = { outcome: "done", reason: undefined, progress: { ...NOTHING, verified: [5] } }

const OPENED: FinishResult = { outcome: "opened", draft: false, url: "https://example.invalid/pull/1" }

const CLEARED: FreshResult = { outcome: "cleared", pullRequest: false }

const harness = (
    result: StartResult = { outcome: "planned", manifest: MANIFEST },
    {
        driven = WORKED,
        finished = OPENED,
        cleared = CLEARED,
        boardDrawn = false,
        afkonfig = { outcome: "absent" },
    }: {
        driven?: DriveResult
        finished?: FinishResult
        cleared?: FreshResult
        boardDrawn?: boolean
        afkonfig?: AfkonfigResult
    } = {},
) => {
    const printed: string[] = []
    const errors: string[] = []
    const started: StartRequest[] = []
    const ended: Progress[] = []
    const freshened: number[] = []
    const released: number[] = []
    let afkonfigsRead = 0
    const run = createRun({
        readAfkonfig: async () => {
            afkonfigsRead += 1
            return afkonfig
        },
        showBoard: createStubShowBoard(),
        fresh: async spec => {
            freshened.push(spec)
            return cleared
        },
        start: async request => {
            started.push(request)
            return result
        },
        drive: async () => driven,
        finish: async (_prepared, progress) => {
            ended.push(progress)
            return finished
        },
        release: async spec => {
            released.push(spec)
        },
        print: line => printed.push(line),
        printError: line => errors.push(line),
        boardDrawn,
    })
    return { run, printed, errors, started, ended, freshened, released, afkonfigsRead: () => afkonfigsRead }
}

const worked = (
    prepared: PreparedRun = PREPARED,
    options: { driven?: DriveResult; finished?: FinishResult; boardDrawn?: boolean } = {},
) => harness({ outcome: "prepared", run: prepared }, options)

describe("createRun", () => {
    it("should print what the invocation was accepted despite", async () => {
        // given
        const { run, errors } = harness()

        // when
        await run(invocation("plan-only", { warnings: ["--branch release is ignored"] }))

        // then
        expect(errors).toEqual(["afk: --branch release is ignored"])
    })

    it("should run on past a warning, which is never fatal", async () => {
        // given
        const { run, started } = harness()

        // when
        await run(invocation("plan-only", { warnings: ["--branch release is ignored"] }))

        // then
        expect(started).toHaveLength(1)
    })

    it("should carry the base an invocation named into the start request", async () => {
        // given
        const { run, started } = harness()

        // when
        await run(invocation("plan-only", { base: "release" }))

        // then
        expect(started[0]?.base).toBe("release")
    })

    it("should start the spec it was invoked for, in the mode it was invoked in", async () => {
        // given
        const { run, started } = harness()

        // when
        await run(invocation("plan-only"))

        // then
        expect(started).toEqual([{ spec: 4, mode: "plan-only", consented: false, pinned: {} }])
    })

    it("should print the execution order of the manifest it planned", async () => {
        // given
        const { run, printed } = harness()

        // when
        await run(invocation("plan-only"))

        // then
        expect(printed).toContain("  1. #5 Plan a spec")
    })

    it("should exit 0 when the spec was planned", async () => {
        // given
        const { run } = harness()

        // when
        const code = await run(invocation("plan-only"))

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should say why the run was refused", async () => {
        // given
        const { run, errors } = harness({ outcome: "refused", reason: "the planner failed: exit 1" })

        // when
        await run(invocation("plan-only"))

        // then
        expect(errors).toContain("afk: the planner failed: exit 1")
    })

    it("should exit 3 when the run was refused", async () => {
        // given
        const { run } = harness({ outcome: "refused", reason: "the planner failed: exit 1" })

        // when
        const code = await run(invocation("plan-only"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should print nothing when the run was refused", async () => {
        // given
        const { run, printed } = harness({ outcome: "refused", reason: "the planner failed: exit 1" })

        // when
        await run(invocation("plan-only"))

        // then
        expect(printed).toEqual([])
    })

    it("should exit 3 when the operator closed the confirmation", async () => {
        // given
        const { run } = harness({ outcome: "aborted" })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should say that nothing was started when the operator closed the confirmation", async () => {
        // given
        const { run, errors } = harness({ outcome: "aborted" })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(errors).toContain("afk: the confirmation was closed, so nothing was started")
    })

    it("should print where a prepared run put its spec branch", async () => {
        // given
        const { run, printed } = worked()

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed).toContain("spec #4: afk/4/spec cut from main")
    })
})

describe("createRun: the end of a run", () => {
    it("should finish with what the slate came to", async () => {
        // given
        const { run, ended } = worked()

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(ended).toEqual([WORKED.progress])
    })

    it("should print where the pull request is", async () => {
        // given
        const { run, printed } = worked()

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed).toContain("pull request opened: https://example.invalid/pull/1")
    })

    it("should exit 0 for a ready pull request over the whole spec", async () => {
        // given
        const { run } = worked()

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should exit 1 for a draft pull request over part of one", async () => {
        // given
        const { run } = worked(PREPARED, { finished: { outcome: "opened", draft: true, url: undefined } })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.partial)
    })

    it("should exit 1 for a partial spec whose draft the operator closed", async () => {
        // given
        const finished: FinishResult = { outcome: "left", draft: true, url: "https://example.invalid/pull/1" }
        const { run } = worked(PREPARED, { finished })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.partial)
    })

    it("should say why no pull request was opened", async () => {
        // given
        const { run, errors } = worked(PREPARED, {
            finished: { outcome: "failed", reason: "afk/4/spec could not be pushed: remote rejected" },
        })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(errors).toContain("afk: afk/4/spec could not be pushed: remote rejected")
    })

    it("should exit 3 when no pull request was opened", async () => {
        // given
        const { run } = worked(PREPARED, {
            finished: { outcome: "failed", reason: "afk/4/spec could not be pushed: remote rejected" },
        })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should open nothing for a run that halted itself", async () => {
        // given
        const { run, ended } = worked(PREPARED, {
            driven: {
                outcome: "halted",
                reason: "afk/4/spec is broken independently of any ticket",
                progress: NOTHING,
            },
        })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(ended).toEqual([])
    })

    it("should exit 3 for a run that halted itself", async () => {
        // given
        const { run } = worked(PREPARED, {
            driven: {
                outcome: "halted",
                reason: "afk/4/spec is broken independently of any ticket",
                progress: NOTHING,
            },
        })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.halted)
    })
})

describe("createRun: a run the operator interrupted", () => {
    const INTERRUPTED: DriveResult = { ...WORKED, outcome: "interrupted" }

    it("should say that what it is reporting on is a run that was stopped", async () => {
        // given
        const { run, printed } = worked(PREPARED, { driven: INTERRUPTED })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed).toContain("afk: the run was interrupted, so it stopped at what was already in flight")
    })

    it("should finish with what the drain landed, because a stopped run is a partial one", async () => {
        // given
        const { run, ended } = worked(PREPARED, { driven: INTERRUPTED })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(ended).toEqual([INTERRUPTED.progress])
    })

    it("should exit 1 for the draft pull request a stopped run comes to", async () => {
        // given
        const { run } = worked(PREPARED, {
            driven: INTERRUPTED,
            finished: { outcome: "opened", draft: true, url: undefined },
        })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.partial)
    })
})

describe("createRun: --force-fresh", () => {
    const startingOver = (mode: Mode): Invocation => ({ ...invocation(mode), forceFresh: true })

    const unclearable = { cleared: { outcome: "failed", reason: "a worktree is locked" } } as const

    it("should throw nothing away when the invocation did not ask for it", async () => {
        // given
        const { run, freshened } = harness()

        // when
        await run(invocation("plan-only"))

        // then
        expect(freshened).toEqual([])
    })

    it("should throw the spec's run away when it was asked for", async () => {
        // given
        const { run, freshened } = harness()

        // when
        await run(startingOver("plan-only"))

        // then
        expect(freshened).toEqual([4])
    })

    it("should start the spec afterwards, so that starting over is one command", async () => {
        // given
        const { run, started } = harness()

        // when
        await run(startingOver("plan-only"))

        // then
        expect(started).toEqual([{ spec: 4, mode: "plan-only", consented: false, pinned: {} }])
    })

    it("should say what is gone, because the flag asks nothing", async () => {
        // given
        const { run, printed } = harness()

        // when
        await run(startingOver("plan-only"))

        // then
        expect(printed).toContain("spec #4: branches deleted, .afk/4 cleared, claims left alone")
    })

    it("should start nothing on top of a run it could not throw away", async () => {
        // given
        const { run, started } = harness(undefined, unclearable)

        // when
        await run(startingOver("plan-only"))

        // then
        expect(started).toEqual([])
    })

    it("should exit halted when it could not throw the run away", async () => {
        // given
        const { run } = harness(undefined, unclearable)

        // when
        const code = await run(startingOver("plan-only"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should say what would not go", async () => {
        // given
        const { run, errors } = harness(undefined, unclearable)

        // when
        await run(startingOver("plan-only"))

        // then
        expect(errors).toContain("afk: a worktree is locked")
    })
})

describe("createRun: the summary of what the slate came to", () => {
    it("should print it where nothing drew the run while it ran", async () => {
        // given
        const { run, printed } = worked(PREPARED, { boardDrawn: false })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed).toContain("verified:     #5")
    })

    it("should print nothing of it where a board already said it per ticket", async () => {
        // given
        const { run, printed } = worked(PREPARED, { boardDrawn: true })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed.some(line => line.startsWith("verified:"))).toBe(false)
    })
})

describe("createRun: the run lock", () => {
    it.each([
        ["a plan", { outcome: "planned", manifest: MANIFEST }],
        ["a refusal", { outcome: "refused", reason: "spec #4 is already being run by afk process 7" }],
        ["an aborted confirmation", { outcome: "aborted" }],
        ["a whole run", { outcome: "prepared", run: PREPARED }],
    ] as const)("should give the lock back after %s", async (_, result) => {
        // given
        const { run, released } = harness(result)

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(released).toEqual([4])
    })

    it("should give the lock back when starting over failed", async () => {
        // given
        const { run, released } = harness(undefined, { cleared: { outcome: "failed", reason: "held" } })

        // when
        await run({ ...invocation("plan-and-implement"), forceFresh: true })

        // then
        expect(released).toEqual([4])
    })

    it("should have no lock to give back for a board it only drew", async () => {
        // given
        const { run, released } = harness()

        // when
        await run(invocation("board-only"))

        // then
        expect(released).toEqual([])
    })
})

describe("createRun: the afkonfig", () => {
    const INVALID: AfkonfigResult = { outcome: "invalid", problems: ["verify: must not be empty"] }

    it("should hand the start what the afkonfig pins", async () => {
        // given
        const { run, started } = harness(undefined, {
            afkonfig: { outcome: "pinned", pinned: { verify: "pnpm check" } },
        })

        // when
        await run(invocation("plan-only"))

        // then
        expect(started[0]?.pinned).toEqual({ verify: "pnpm check" })
    })

    it.each([
        ["plan-only", 1],
        ["plan-and-implement", 1],
        ["implement-only", 0],
        ["board-only", 0],
    ] as const)("should read it under %s %i times, being read only by a mode that plans", async (mode, times) => {
        // given
        const { run, afkonfigsRead } = harness()

        // when
        await run(invocation(mode))

        // then
        expect(afkonfigsRead()).toBe(times)
    })

    it("should exit 3 over an invalid afkonfig", async () => {
        // given
        const { run } = harness(undefined, { afkonfig: INVALID })

        // when
        const code = await run(invocation("plan-only"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should name every correction an invalid afkonfig needs", async () => {
        // given
        const { run, errors } = harness(undefined, { afkonfig: INVALID })

        // when
        await run(invocation("plan-only"))

        // then
        expect(errors).toEqual(["afk: afkonfig.mts is invalid. Correct:", "  - verify: must not be empty"])
    })

    it.each([
        ["invalid", INVALID],
        ["refused", { outcome: "refused", reason: "this is not a git worktree" }],
    ] as const)("should throw nothing away over an afkonfig read as %s", async (_, afkonfig) => {
        // given
        const { run, freshened } = harness(undefined, { afkonfig })

        // when
        await run({ ...invocation("plan-only"), forceFresh: true })

        // then
        expect(freshened).toEqual([])
    })

    it("should start nothing over an invalid afkonfig", async () => {
        // given
        const { run, started } = harness(undefined, { afkonfig: INVALID })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(started).toEqual([])
    })
})
