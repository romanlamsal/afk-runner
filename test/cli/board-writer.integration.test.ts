import type { Key } from "node:readline"
import { describe, expect, it } from "vitest"
import { createTerminalBoard, type TerminalBoard } from "../../src/cli/board-writer.ts"
import type { BoardRow, BoardView } from "../../src/domain/board.ts"
import { type EmulatedTerminal, emulatedTerminal } from "../fixtures/terminal.ts"

/**
 * The writer against a terminal emulator: what ends up on the screen and in the scrollback once a
 * terminal has made of the writer's output, which no assertion about the output itself can say. A
 * frame can be right on its own and the terminal still wrong, when a resize pushes it into scrollback
 * or a key press moves nothing (ADR-0041, ADR-0042).
 */

const NOTE =
    "- main is 1 commit ahead of origin/main, and the spec branch is cut from it, so those commits are part of this run"

const BEFORE = [NOTE, "spec #52: afk/52/spec cut from main", "gate:   .afk/52/gate", "verify: pnpm verify"]

const row = (ticket: number): BoardRow => ({
    ticket,
    title: "A ticket",
    track: "implement",
    steps: [{ step: "setup", state: "settled", outcome: "ok" }],
    waiting: false,
    conclusion: undefined,
    detail: undefined,
    elapsed: undefined,
    quiet: false,
    blockedBy: [],
})

/** Fourteen tickets, which is the spec whose notice piled up in scrollback. */
const VIEW: BoardView = {
    at: "2026-09-29T14:55:17.814Z",
    rows: Array.from({ length: 14 }, (_, index) => row(53 + index)),
}

const key = (name: string): Key => ({ name })

const PROMPT = "$ afk 52 --resume --implement-only"

/**
 * A run on an emulated terminal whose screen is full already, as an operator's is: the shell's
 * history above the prompt, then the lines afk printed before its board, then the board.
 */
const running = async ({
    rows = 20,
    columns = 120,
    before = BEFORE,
}: {
    rows?: number
    columns?: number
    before?: readonly string[]
} = {}): Promise<{
    terminal: EmulatedTerminal
    board: TerminalBoard
    press: (...keys: readonly Key[]) => Promise<void>
    exit: () => Promise<void>
}> => {
    const terminal = emulatedTerminal({ rows, columns })
    const pressed: ((key: Key) => void)[] = []
    const exits: (() => void)[] = []
    const board = createTerminalBoard({
        write: terminal.write,
        writeError: terminal.write,
        errorsElsewhere: false,
        columns: terminal.columns,
        rows: terminal.rows,
        onResize: terminal.onResize,
        keys: { take: listener => pressed.push(listener), release: () => undefined },
        interrupt: () => undefined,
        onExit: hook => exits.push(hook),
    })
    for (let line = 0; line < 30; line += 1) {
        terminal.write(`history ${line}\n`)
    }
    terminal.write(`${PROMPT}\n`)
    for (const line of before) {
        board.print(line)
    }
    board.show(VIEW)
    await terminal.settled()

    const press = async (...keys: readonly Key[]): Promise<void> => {
        for (const each of keys) {
            for (const listener of pressed) {
                listener(each)
            }
        }
        await terminal.settled()
    }

    /** The process going away before the end, as a kill or a crash does. */
    const exit = async (): Promise<void> => {
        for (const hook of exits) {
            hook()
        }
        await terminal.settled()
    }

    return { terminal, board, press, exit }
}

/** What the main screen holds under the prompt afk was started from. */
const sinceThePrompt = async (terminal: EmulatedTerminal): Promise<readonly string[]> => {
    const main = await terminal.main()
    return main.slice(main.indexOf(PROMPT) + 1)
}

/** More presses than any window here has lines to scroll, so that a key that moves nothing ends the loop. */
const MOST_PRESSES = 40

/** A window dragged to a new size a row or a column at a time, which is a resize for every one. */
const dragTo = async (terminal: EmulatedTerminal, to: { rows?: number; columns?: number }): Promise<void> => {
    while ((to.rows ?? terminal.rows()) < terminal.rows() || (to.columns ?? terminal.columns()) < terminal.columns()) {
        await terminal.resize({
            rows: Math.max(to.rows ?? terminal.rows(), terminal.rows() - 1),
            columns: Math.max(to.columns ?? terminal.columns(), terminal.columns() - 1),
        })
    }
}

/** The rows that are there more than once, blank ones aside. */
const twice = (rows: readonly string[]): readonly string[] =>
    rows.filter((row, index) => row !== "" && rows.indexOf(row) !== index)

describe("createTerminalBoard on a terminal", () => {
    it.each([
        ["shortened", { rows: 13 }],
        ["narrowed", { columns: 100 }],
    ] as const)("should leave no row on the main screen twice, however often the window is %s", async (_name, to) => {
        // given: a window dragged to its new size a row or a column at a time, a resize for each
        const { terminal, board, press } = await running()
        await press(key("home"))
        await dragTo(terminal, to)

        // when
        board.end()

        // then
        expect(twice(await terminal.main())).toEqual([])
    })

    it.each([[0], [1], [3]] as const)(
        "should move every row of the screen up by exactly one with a ↓ after %i more",
        async presses => {
            // given: nothing wrapped, and a window short enough to scroll
            const { press, terminal } = await running({ rows: 12 })
            await press(key("home"), ...Array.from({ length: presses }, () => key("down")))
            const before = await terminal.screen()

            // when
            await press(key("down"))

            // then: the rows between the markers, one further up
            expect((await terminal.screen()).slice(1, 8)).toEqual(before.slice(2, 9))
        },
    )

    it("should leave everything it printed on the main screen once at the end, the board under the lines before it", async () => {
        // given
        const { terminal, board, press } = await running()
        await press(key("down"), key("home"), key("end"))

        // when
        board.end()

        // then
        expect(await sinceThePrompt(terminal)).toEqual([
            ...BEFORE,
            ...Array.from({ length: 14 }, (_, index) => `   ${53 + index}  setup`),
            "last event 2026-09-29T14:55:17.814Z",
        ])
    })

    it.each([
        ["down", "home", "end"],
        ["up", "end", "home"],
    ] as const)(
        "should move the screen with every %s until it is at the other end, wrapped lines and all",
        async (direction, from, to) => {
            // given: a window too narrow for the note, which wraps into two rows under a line of its own
            const { press, terminal } = await running({
                rows: 10,
                columns: 80,
                before: ["spec #52: afk/52/spec cut from main", NOTE],
            })
            await press(key(to))
            const end = (await terminal.screen()).join("\n")
            await press(key(from))

            // when
            const screens = [(await terminal.screen()).join("\n")]
            while (screens.length < MOST_PRESSES && screens.at(-1) !== end) {
                await press(key(direction))
                screens.push((await terminal.screen()).join("\n"))
            }

            // then
            expect(screens.filter((screen, index) => screen === screens[index - 1])).toEqual([])
        },
    )

    it("should give the main screen back, the board painted on it, on an exit that comes before the end", async () => {
        // given
        const { terminal, exit } = await running()

        // when
        await exit()

        // then
        expect((await sinceThePrompt(terminal)).at(-1)).toBe("last event 2026-09-29T14:55:17.814Z")
    })

    it("should show the board on the alternate screen while it runs", async () => {
        // given
        const { terminal } = await running()

        // when
        const alternate = await terminal.alternate()

        // then
        expect(alternate).toBe(true)
    })

    it("should keep what afk said on its way out on the main screen, where the exit paints it", async () => {
        // given
        const { terminal, board, exit } = await running()
        board.error("afk: killed")

        // when
        await exit()

        // then
        expect(await sinceThePrompt(terminal)).toContain("afk: killed")
    })
})
