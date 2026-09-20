import { describe, expect, it } from "vitest"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT, type ExitCode } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import { type BoardStep, TRAIL_STEPS } from "../../src/domain/board.ts"
import type { LifecycleEvent, Step } from "../../src/domain/events.ts"
import { createShowBoardService } from "../../src/service/board.ts"
import type { StartRun } from "../../src/service/start.ts"
import { createWatchBoardService } from "../../src/service/watch.ts"
import { createFakeActivity } from "../fakes/activity.ts"
import { createFakeBoard } from "../fakes/board.ts"
import { createStubDrive } from "../fakes/drive.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createStubFinish } from "../fakes/finish.ts"
import { createStubFresh } from "../fakes/fresh.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeManifestStore } from "../fakes/manifest-store.ts"
import { createStubRelease } from "../fakes/release.ts"
import { createFakeRunLock } from "../fakes/run-lock.ts"
import { createFakeTicker } from "../fakes/ticker.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * `afk <spec> --board-only`, from the argument vector to the view the board was shown. Nothing here
 * reaches past a port, and the assertions are on the view rather than on anything rendered: what a
 * frame looks like is the frame's own suite (ADR-0030).
 */
const MANIFEST = manifestOf([ticket(5), ticket(6, [5])])

const at = (minute: number): string => `2026-01-01T10:0${minute}:00.000Z`

/**
 * A row's trail, written as the steps that are not still ahead: a row covers every step of the run
 * whatever track its ticket is on (ADR-0031).
 */
const steps = (weights: Partial<Record<Step, "ahead" | "running" | "interrupted" | "ok">>): readonly BoardStep[] =>
    TRAIL_STEPS.map((step): BoardStep => {
        const weight = weights[step] ?? "ahead"
        return weight === "ok" ? { step, state: "settled", outcome: "ok" } : { step, state: weight }
    })

/** A run the viewer must never start: reaching `start` at all is the failure this catches. */
const refusingStart: StartRun = async () => ({ outcome: "refused", reason: "the viewer started a run" })

const harness = ({
    planned = true,
    held = true,
    log = [],
    changes = [],
    writes = [],
}: {
    planned?: boolean
    /** Whether a live afk holds the run, which is what its trailing `running` events turn on. */
    held?: boolean
    /** What the run directory's records say each path last had written to it, and when. */
    writes?: readonly (readonly [string, string])[]
    log?: readonly LifecycleEvent[]
    /** What a run appends while the viewer is following: one group per change to the log. */
    changes?: readonly (readonly LifecycleEvent[])[]
} = {}) => {
    const board = createFakeBoard()
    const events = createFakeEventLog(log, { changes })
    const manifests = createFakeManifestStore(planned ? { ok: true, manifest: MANIFEST } : undefined)
    const git = createFakeGit()
    const activity = createFakeActivity()
    const lock = createFakeRunLock(held ? { heldBy: { pid: 4242 } } : {})
    for (const [path, when] of writes) {
        activity.write(path, new Date(when))
    }
    const printed: string[] = []
    const errors: string[] = []
    const cli = createCli({
        isInteractive: () => false,
        printError: line => errors.push(line),
        run: createRun({
            release: createStubRelease(),
            fresh: createStubFresh(),
            showBoard: createShowBoardService({
                cwd: "/repo",
                git: git.git,
                manifests: manifests.store,
                watch: createWatchBoardService({
                    activity: activity.activity,
                    board: board.board,
                    events: events.log,
                    lock: lock.lock,
                    now: () => new Date(at(9)),
                    ticker: createFakeTicker(),
                }),
            }),
            start: refusingStart,
            drive: createStubDrive(),
            finish: createStubFinish(),
            print: line => printed.push(line),
            printError: line => errors.push(line),
            boardDrawn: true,
        }),
    })
    return { cli, board, events, manifests, printed, errors }
}

describe("afk <spec> --board-only", () => {
    it("should refuse a spec that has never been planned", async () => {
        // given
        const { cli, errors } = harness({ planned: false })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(errors).toContain("afk: spec #4 has not been planned, so there is no board to draw")
    })

    it("should draw no board for a spec that has never been planned", async () => {
        // given
        const { cli, board } = harness({ planned: false })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown).toEqual([])
    })

    it("should exit halted when the spec has no manifest", async () => {
        // given
        const { cli } = harness({ planned: false })

        // when
        const code = await cli(["4", "--board-only"])

        // then
        expect(code).toEqual(EXIT.halted)
    })

    it("should draw the whole slate with every step ahead when the log is empty", async () => {
        // given
        const { cli, board } = harness()

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown).toEqual([
            {
                rows: [
                    {
                        ticket: 5,
                        title: "ticket 5",
                        track: "implement",
                        steps: steps({}),
                        waiting: false,
                        conclusion: undefined,
                        detail: undefined,
                        quiet: false,
                    },
                    {
                        ticket: 6,
                        title: "ticket 6",
                        track: "implement",
                        steps: steps({}),
                        waiting: false,
                        conclusion: undefined,
                        detail: undefined,
                        quiet: false,
                    },
                ],
            },
        ])
    })

    it("should draw a step the log started and has not ended as running", async () => {
        // given
        const { cli, board } = harness({
            log: [{ ticket: 5, step: "implement", outcome: "running", at: at(1) }],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown[0]?.rows[0]?.steps).toEqual(steps({ implement: "running" }))
    })

    it("should draw a step the log left running as interrupted when nothing holds the run", async () => {
        // given: the log a killed run left behind, and no afk holding the spec any more
        const { cli, board } = harness({
            held: false,
            log: [{ ticket: 5, step: "implement", outcome: "running", at: at(1) }],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown[0]?.rows[0]?.steps).toEqual(steps({ implement: "interrupted" }))
    })

    it.each([
        [
            "every ticket verified",
            [
                { ticket: 5, step: "gate", outcome: "ok", at: at(1) },
                { ticket: 6, step: "gate", outcome: "ok", at: at(2) },
            ],
            EXIT.complete,
        ],
        [
            "one ticket verified and one failed",
            [
                { ticket: 5, step: "gate", outcome: "ok", at: at(1) },
                { ticket: 6, step: "implement", outcome: "failed", at: at(2) },
            ],
            EXIT.partial,
        ],
        ["a run that never started", [], EXIT.partial],
    ] as const satisfies readonly (readonly [string, readonly LifecycleEvent[], ExitCode])[])(
        "should exit with the run's own code for %s",
        async (_conclusion, log, expected) => {
            // given
            const { cli } = harness({ log })

            // when
            const code = await cli(["4", "--board-only"])

            // then
            expect(code).toEqual(expected)
        },
    )

    it("should draw a frame for the log as it stands and for each change to it", async () => {
        // given
        const { cli, board } = harness({
            changes: [
                [{ ticket: 5, step: "setup", outcome: "running", at: at(1) }],
                [{ ticket: 5, step: "setup", outcome: "ok", at: at(2) }],
            ],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown.map(view => view.rows[0]?.steps)).toEqual([
            steps({}),
            steps({ setup: "running" }),
            steps({ setup: "ok" }),
        ])
    })

    it("should keep following while a step the log started has not ended", async () => {
        // given
        const { cli, board } = harness({
            log: [
                { ticket: 5, step: "gate", outcome: "ok", at: at(1) },
                { ticket: 6, step: "gate", outcome: "running", at: at(2) },
            ],
            changes: [[{ ticket: 6, step: "gate", outcome: "ok", at: at(3) }]],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown).toHaveLength(2)
    })

    it("should stop at the frame the log concluded on", async () => {
        // given
        const { cli, board } = harness({
            log: [
                { ticket: 5, step: "gate", outcome: "ok", at: at(1) },
                { ticket: 6, step: "gate", outcome: "ok", at: at(2) },
            ],
            changes: [[{ ticket: 5, step: "revert", outcome: "failed", at: at(3) }]],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown).toHaveLength(1)
    })

    it("should exit with the run's own code once a log it followed concludes", async () => {
        // given
        const { cli } = harness({
            log: [{ ticket: 5, step: "gate", outcome: "running", at: at(1) }],
            changes: [
                [{ ticket: 5, step: "gate", outcome: "ok", at: at(2) }],
                [{ ticket: 6, step: "gate", outcome: "ok", at: at(3) }],
            ],
        })

        // when
        const code = await cli(["4", "--board-only"])

        // then
        expect(code).toEqual(EXIT.complete)
    })

    it.each([
        ["still writing", at(8), false],
        ["gone quiet", at(2), true],
    ] as const)("should draw a running step whose transcript was last written to %s", async (_case, written, quiet) => {
        // given: the viewer derives its view at 10:09
        const transcript = ".afk/4/transcripts/t5-implement-1.jsonl"
        const { cli, board } = harness({
            log: [{ ticket: 5, step: "implement", outcome: "running", at: at(1), transcriptPath: transcript }],
            writes: [[transcript, written]],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect(board.shown[0]?.rows[0]?.quiet).toBe(quiet)
    })

    it("should write nothing to the run directory", async () => {
        // given
        const { cli, events, manifests } = harness({
            log: [{ ticket: 5, step: "implement", outcome: "running", at: at(1) }],
        })

        // when
        await cli(["4", "--board-only"])

        // then
        expect({ appended: events.appended, written: manifests.written }).toEqual({
            appended: [{ ticket: 5, step: "implement", outcome: "running", at: at(1) }],
            written: [],
        })
    })
})
