import { describe, expect, it } from "vitest"
import { boardLines } from "../../src/cli/board-lines.ts"
import type { BoardRow, BoardStep, BoardView, SettledOutcome, Track } from "../../src/domain/board.ts"
import type { Step } from "../../src/domain/events.ts"

/**
 * The board off a terminal, asserted as what it is: a mapping over two consecutive views. No
 * terminal, no cursor and no fakes — the inputs are two views and the output is the lines the second
 * one is news for.
 */

const trail = (
    steps: Readonly<Record<string, SettledOutcome | "running" | "interrupted" | "ahead">>,
): readonly BoardStep[] =>
    Object.entries(steps).map(([name, weight]) => {
        const step = name as Step
        return weight === "running" || weight === "interrupted" || weight === "ahead"
            ? { step, state: weight }
            : { step, state: "settled", outcome: weight }
    })

const row = (steps: readonly BoardStep[], rest: { track?: Track; detail?: string } = {}): BoardRow => ({
    ticket: 7,
    title: "Implement the slate",
    track: rest.track ?? "implement",
    steps,
    waiting: false,
    conclusion: undefined,
    detail: rest.detail,
    elapsed: undefined,
    quiet: false,
    blockedBy: [],
})

const view = (...rows: readonly BoardRow[]): BoardView => ({ rows, at: undefined })

const UNTOUCHED = row(trail({ setup: "ahead", implement: "ahead" }))

const SETTING_UP = row(trail({ setup: "running", implement: "ahead" }))

/** The same setup, in a run nothing holds any more: the step is open and nobody is doing it. */
const SETUP_INTERRUPTED = row(trail({ setup: "interrupted", implement: "ahead" }))

describe("boardLines", () => {
    it("should say nothing for the first view it is given", () => {
        // given
        const first = view(SETTING_UP)

        // when
        const lines = boardLines(undefined, first)

        // then
        expect(lines).toEqual([])
    })

    it("should say nothing for a row that did not change", () => {
        // given
        const before = view(SETTING_UP)

        // when
        const lines = boardLines(before, view(SETTING_UP))

        // then
        expect(lines).toEqual([])
    })

    it("should say nothing for a ticket that stopped being blocked", () => {
        // given
        const before = view({ ...UNTOUCHED, blockedBy: [5] })

        // when
        const lines = boardLines(before, view(UNTOUCHED))

        // then
        expect(lines).toEqual([])
    })

    it("should name a step the run stopped being held under", () => {
        // given
        const before = view(SETTING_UP)

        // when
        const lines = boardLines(before, view(SETUP_INTERRUPTED))

        // then
        expect(lines).toEqual(["#7 setup interrupted"])
    })

    it("should say nothing for a step that was interrupted already", () => {
        // given
        const before = view(SETUP_INTERRUPTED)

        // when
        const lines = boardLines(before, view(SETUP_INTERRUPTED))

        // then
        expect(lines).toEqual([])
    })

    it("should name the ticket and the step of a step that began", () => {
        // given
        const before = view(UNTOUCHED)

        // when
        const lines = boardLines(before, view(SETTING_UP))

        // then
        expect(lines).toEqual(["#7 setup running"])
    })

    it.each([
        ["a step that went green", "ok"],
        ["a step that broke", "failed"],
        ["a step that will not happen", "skipped"],
        ["a step git stopped part-way", "conflicted"],
    ] as const)("should name the ticket, the step and the outcome of %s", (_case, outcome) => {
        // given
        const before = view(SETTING_UP)

        // when
        const lines = boardLines(before, view(row(trail({ setup: outcome, implement: "ahead" }))))

        // then
        expect(lines).toEqual([`#7 setup ${outcome}`])
    })

    it("should say why a step failed, where the row carries a reason", () => {
        // given
        const before = view(SETTING_UP)
        const broken = row(trail({ setup: "failed", implement: "ahead" }), { detail: "the setup command exited 1" })

        // when
        const lines = boardLines(before, view(broken))

        // then
        expect(lines).toEqual(["#7 setup failed: the setup command exited 1"])
    })

    it("should leave a reason off a step that simply worked", () => {
        // given
        const before = view(SETTING_UP)
        const done = row(trail({ setup: "ok", implement: "ahead" }), { detail: "resolved by taking both sides" })

        // when
        const lines = boardLines(before, view(done))

        // then
        expect(lines).toEqual(["#7 setup ok"])
    })

    it("should lose neither transition where one view settles a step and starts the next", () => {
        // given
        const before = view(SETTING_UP)
        const implementing = row(trail({ setup: "ok", implement: "running" }))

        // when
        const lines = boardLines(before, view(implementing))

        // then
        expect(lines).toEqual(["#7 setup ok", "#7 implement running"])
    })

    it("should say only the step that began when a ticket reaches the merge track", () => {
        // given: a row spans every step, so a track change leaves no trail behind it
        const before = view(row(trail({ setup: "ok", implement: "ok", rebase: "ahead" })))
        const merging = row(trail({ setup: "ok", implement: "ok", rebase: "running" }), { track: "merge" })

        // when
        const lines = boardLines(before, view(merging))

        // then
        expect(lines).toEqual(["#7 rebase running"])
    })

    it("should say a step that was attempted again and broke again", () => {
        // given
        const before = view(row(trail({ setup: "ok", implement: "running" })))
        const broken = row(trail({ setup: "ok", implement: "failed" }), { detail: "the second attempt too" })

        // when
        const lines = boardLines(before, view(broken))

        // then
        expect(lines).toEqual(["#7 implement failed: the second attempt too"])
    })

    it("should say nothing for a step that was already running on the view before", () => {
        // given: a step the log started and has not ended, which is news only the once
        const before = view(row(trail({ setup: "ok", implement: "running" })))

        // when
        const lines = boardLines(before, view(row(trail({ setup: "ok", implement: "running" }))))

        // then
        expect(lines).toEqual([])
    })

    it("should say a step that started again after it broke", () => {
        // given
        const before = view(row(trail({ setup: "ok", implement: "failed" })))

        // when
        const lines = boardLines(before, view(row(trail({ setup: "ok", implement: "running" }))))

        // then
        expect(lines).toEqual(["#7 implement running"])
    })

    it("should say a line per row that changed, and only for those", () => {
        // given
        const other = (steps: readonly BoardStep[]): BoardRow => ({ ...row(steps), ticket: 8 })
        const before = view(SETTING_UP, other(trail({ setup: "ahead", implement: "ahead" })))

        // when
        const lines = boardLines(before, view(SETTING_UP, other(trail({ setup: "running", implement: "ahead" }))))

        // then
        expect(lines).toEqual(["#8 setup running"])
    })
})
