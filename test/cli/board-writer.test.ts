import type { Key } from "node:readline"
import { describe, expect, it } from "vitest"
import {
    createLineBoard,
    createTerminalBoard,
    type TerminalBoard,
    type TerminalBoardDeps,
} from "../../src/cli/board-writer.ts"
import type { BoardNotice, BoardRow, BoardView } from "../../src/domain/board.ts"

/**
 * The writer's own rules and none of the frame's: how far it rewinds before it draws again, that a
 * terminal which went away cannot fail a run, and that a notice arriving out of the loop's turn — a
 * signal handler is the caller — reaches the screen at once and stays on the frames after it
 * (ADR-0029). What a frame is made of is the frame's, and it is asserted there.
 */

/** Where a frame begins and ends: synchronized output, so the terminal shows it at once or not yet. */
const BEGIN = "\u001b[?2026h"
const END = "\u001b[?2026l"

/** What a line is written with after its text: cleared to its end, never cleared before it. */
const CLEAR_TO_END = "\u001b[K"

/** What clears a whole line, which a frame never does before writing it. */
const CLEAR_LINE = "\u001b[2K"

/** What clears everything below the cursor, once a frame's lines are down. */
const ERASE_DOWN = "\u001b[J"

/** The cursor hidden, from the first frame on, and shown again once the board is done with the terminal. */
const HIDE_CURSOR = "\u001b[?25l"
const SHOW_CURSOR = "\u001b[?25h"

/** Cursor up by that many lines. */
const up = (lines: number): string => `\u001b[${lines}A`

/** Cursor up, by however many lines. */
const UP = new RegExp(String.raw`\u001b\[\d+A`)

const ROW: BoardRow = {
    ticket: 7,
    title: "Implement the slate",
    track: "implement",
    steps: [
        { step: "setup", state: "settled", outcome: "ok" },
        { step: "implement", state: "running" },
    ],
    waiting: false,
    conclusion: undefined,
    detail: undefined,
    elapsed: undefined,
    quiet: false,
    blockedBy: [],
}

const VIEW: BoardView = { at: "2026-09-15T11:18:38.314Z", rows: [ROW] }

const DRAINING: BoardNotice = { kind: "draining", line: "afk: interrupted — starting nothing new" }

const ERROR: BoardNotice = { kind: "error", line: "afk: halted" }

/** Says a notice the way its caller does: an error through `error`, the drain notice through `notice`. */
const say = (board: TerminalBoard, notice: BoardNotice): void =>
    notice.kind === "error" ? board.error(notice.line) : board.notice(notice)

/** Thirteen tickets, which is the spec whose board leaked into scrollback (#66). */
const TALL: BoardView = {
    at: VIEW.at,
    rows: Array.from({ length: 13 }, (_, index) => ({ ...ROW, ticket: 21 + index })),
}

/** A frame's lines, with the synchronized-output wrapping, the rewind and the trailing erase taken off. */
const linesOf = (chunk: string | undefined): readonly string[] =>
    (chunk ?? "").replace(BEGIN, "").replace(UP, "").replace(HIDE_CURSOR, "").replace(END, "").split("\n").slice(0, -1)

/** Any CSI escape sequence: colour, clearing, cursor movement. */
const ESCAPE = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, "g")

/** A line as the terminal shows it, with every escape sequence taken off. */
const visible = (line: string): string => line.replace(ESCAPE, "")

/** What the test can see of a writer once it has ended. */
type Ended = ReturnType<typeof harness>

/** What a writer made outside of a test's own terminal needs besides it: no keys, and nobody to tell. */
const DETACHED: Pick<TerminalBoardDeps, "keys" | "interrupt" | "onExit"> = {
    keys: undefined,
    interrupt: () => undefined,
    onExit: () => undefined,
}

/**
 * The writer over a terminal the test can resize: `resize` changes the window's size and then tells
 * the writer, the way stdout's `'resize'` does. `press` is the operator at the keyboard, which is
 * only there where stdin is a terminal, and `exit` is the process going away, however it does.
 */
const harness = ({
    rows = 40,
    columns = 80,
    errorsElsewhere = false,
    fails = false,
    keyboard = true,
}: {
    rows?: number
    columns?: number
    errorsElsewhere?: boolean
    /** Every write throws, as one to a terminal that went away does. */
    fails?: boolean
    /** Whether stdin is a terminal, and so whether there are keys to take. */
    keyboard?: boolean
} = {}) => {
    const written: string[] = []
    const errored: string[] = []
    const size = { rows, columns }
    const listeners: (() => void)[] = []
    const pressed: ((key: Key) => void)[] = []
    const exits: (() => void)[] = []
    const stdin = { taken: false, released: false }
    const interrupts = { raised: 0 }
    return {
        written,
        errored,
        stdin,
        interrupts,
        resize: (to: { rows?: number; columns?: number }) => {
            Object.assign(size, to)
            for (const listener of listeners) {
                listener()
            }
        },
        press: (...keys: readonly Key[]) => {
            for (const key of keys) {
                for (const listener of pressed) {
                    listener(key)
                }
            }
        },
        exit: () => {
            for (const hook of exits) {
                hook()
            }
        },
        board: createTerminalBoard({
            keys: keyboard
                ? {
                      take: listener => {
                          stdin.taken = true
                          pressed.push(listener)
                      },
                      release: () => {
                          stdin.released = true
                      },
                  }
                : undefined,
            interrupt: () => {
                interrupts.raised += 1
            },
            onExit: hook => exits.push(hook),
            write: chunk => {
                if (fails) {
                    throw new Error("EPIPE")
                }
                written.push(chunk)
            },
            writeError: chunk => errored.push(chunk),
            errorsElsewhere,
            columns: () => size.columns,
            rows: () => size.rows,
            onResize: listener => listeners.push(listener),
        }),
    }
}

describe("createTerminalBoard", () => {
    it("should redraw with the notice as soon as it is given one, rather than wait for the next frame", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)

        // when
        board.notice(DRAINING)

        // then
        expect(written.at(-1)).toContain(DRAINING.line)
    })

    it("should keep the notice on every frame after it", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        board.notice(DRAINING)

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)).toContain(DRAINING.line)
    })

    it("should keep Draining in the footer on every frame after the drain notice", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        board.notice(DRAINING)

        // when
        board.show(VIEW)

        // then
        expect(linesOf(written.at(-1)).at(-1)).toContain("Draining")
    })

    it("should rewind over every line it last drew before it draws again", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        const drawn = linesOf(written.at(-1)).length

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(drawn)}`)).toBe(true)
    })

    it("should rewind over nothing before the first frame, where there is nothing drawn to rewind over", () => {
        // given
        const { written, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)).not.toMatch(UP)
    })

    it("should draw no frame taller than one line fewer than the window, however often it redraws", () => {
        // given
        const { written, board } = harness({ rows: 13 })
        for (let frame = 0; frame < 20; frame++) {
            board.show(TALL)
        }

        // when
        board.show(TALL)

        // then
        expect(linesOf(written.at(-1)).length).toBeLessThanOrEqual(12)
    })

    it.each([
        ["begin", (chunk: string) => chunk.startsWith(BEGIN)],
        ["end", (chunk: string) => chunk.endsWith(END)],
    ] as const)("should %s every frame's synchronized output", (_, wrapping) => {
        // given
        const { written, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(wrapping(written.at(-1) ?? "")).toBe(true)
    })

    it("should overwrite each line and then clear it to its end", () => {
        // given
        const { written, board } = harness()
        board.show(TALL)

        // when
        board.show(TALL)

        // then
        expect(linesOf(written.at(-1)).every(line => line.endsWith(CLEAR_TO_END))).toBe(true)
    })

    it("should never clear a line before it is written", () => {
        // given
        const { written, board } = harness()
        board.show(TALL)

        // when
        board.show(TALL)

        // then
        expect(written.at(-1)).not.toContain(CLEAR_LINE)
    })

    it("should not clear after a line as wide as the terminal, whose last character it would erase", () => {
        // given
        const { written, board } = harness({ columns: 12 })

        // when
        board.show(VIEW)

        // then
        expect(linesOf(written.at(-1))[0]?.endsWith(CLEAR_TO_END)).toBe(false)
    })

    it("should erase what a taller last frame left below the new one", () => {
        // given
        const { written, board } = harness()
        board.show(TALL)

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.endsWith(`${ERASE_DOWN}${END}`)).toBe(true)
    })

    it("should swallow a write that fails, because a terminal that went away is not a run that failed", () => {
        // given
        const { board } = harness({ fails: true })

        // when
        const drawing = () => board.show(VIEW)

        // then
        expect(drawing).not.toThrow()
    })

    it("should redraw the last view as soon as the window is resized", () => {
        // given
        const { written, resize, board } = harness()
        board.show(VIEW)
        written.length = 0

        // when
        resize({ rows: 30 })

        // then
        expect(written.at(-1)).toContain(VIEW.at)
    })

    it.each([
        ["shortened", { rows: 8 }, (chunk: string | undefined) => linesOf(chunk).length, 7],
        [
            "narrowed",
            { columns: 20 },
            (chunk: string | undefined) => Math.max(...linesOf(chunk).map(line => visible(line).length)),
            20,
        ],
    ] as const)("should fit the redraw to a window %s mid-run", (_, to, measure, limit) => {
        // given
        const { written, resize, board } = harness()
        board.show(TALL)

        // when
        resize(to)

        // then
        expect(measure(written.at(-1))).toBeLessThanOrEqual(limit)
    })

    it("should rewind no further than one line fewer than the resized window", () => {
        // given
        const { written, resize, board } = harness()
        board.show(TALL)

        // when
        resize({ rows: 5 })

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(4)}`)).toBe(true)
    })

    it("should erase down from where it rewound to before it draws the resized frame", () => {
        // given
        const { written, resize, board } = harness()
        board.show(TALL)

        // when
        resize({ rows: 5 })

        // then
        expect(written.at(-1)?.replace(UP, "").startsWith(`${BEGIN}${ERASE_DOWN}`)).toBe(true)
    })

    it("should rewind over every line it drew where the resized window can reach them all", () => {
        // given
        const { written, resize, board } = harness({ rows: 20 })
        board.show(VIEW)
        const drawn = linesOf(written.at(-1)).length

        // when
        resize({ rows: 30 })

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(drawn)}${ERASE_DOWN}`)).toBe(true)
    })

    it("should swallow a terminal that fails to say its size on a resize", () => {
        // given
        const listeners: (() => void)[] = []
        let gone = false
        const board = createTerminalBoard({
            write: () => undefined,
            writeError: () => undefined,
            errorsElsewhere: false,
            columns: () => 80,
            rows: () => {
                if (gone) {
                    throw new Error("EBADF")
                }
                return 40
            },
            onResize: listener => listeners.push(listener),
            ...DETACHED,
        })
        board.show(VIEW)
        gone = true

        // when
        const resizing = () => {
            for (const listener of listeners) {
                listener()
            }
        }

        // then
        expect(resizing).not.toThrow()
    })

    it("should write nothing for a resize before the first frame", () => {
        // given
        const { written, resize } = harness()

        // when
        resize({ rows: 10 })

        // then
        expect(written).toEqual([])
    })

    it("should write nothing for a notice that arrives before the first frame", () => {
        // given
        const { written, board } = harness()

        // when
        board.notice(DRAINING)

        // then
        expect(written).toEqual([])
    })
})

/**
 * Everything afk prints in the process goes through the terminal adapter: written through before the
 * first frame, taken back into the window at it where cursor-up still reaches, drawn under the board
 * from then on, and painted whole at the end (ADR-0041).
 */
describe("createTerminalBoard: printed lines", () => {
    const SUMMARY = ["spec #66: afk/66/spec cut from main", "gate:   .afk/66/gate", "setup:  pnpm i"]
    const LINK = "draft pull request opened: https://github.com/o/r/pull/1"

    it("should write a line printed before the first frame straight through", () => {
        // given
        const { written, board } = harness()

        // when
        board.print(SUMMARY[0] ?? "")

        // then
        expect(written).toEqual([`${SUMMARY[0]}\n`])
    })

    it("should rewind over the lines printed before the board at its first frame", () => {
        // given
        const { written, board } = harness()
        for (const line of SUMMARY) {
            board.print(line)
        }

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(SUMMARY.length)}`)).toBe(true)
    })

    it("should draw the lines printed before the board above its rows", () => {
        // given
        const { written, board } = harness()
        for (const line of SUMMARY) {
            board.print(line)
        }

        // when
        board.show(VIEW)

        // then
        expect(linesOf(written.at(-1)).slice(0, SUMMARY.length)).toEqual(SUMMARY.map(line => `${line}${CLEAR_TO_END}`))
    })

    it("should rewind no further than cursor-up reaches, leaving what is in scrollback there", () => {
        // given
        const { written, board } = harness({ rows: 8 })
        for (let line = 0; line < 20; line++) {
            board.print(`line ${line}`)
        }

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(7)}`)).toBe(true)
    })

    it("should not draw a line again that was beyond cursor-up's reach", () => {
        // given
        const { written, board } = harness({ rows: 8 })
        for (let line = 0; line < 20; line++) {
            board.print(`line ${line}`)
        }
        board.show(VIEW)

        // when
        board.end()

        // then
        expect(linesOf(written.at(-1))[0]).toBe(`line 13${CLEAR_TO_END}`)
    })

    it("should open at the board's first row, with the lines printed before it hidden above", () => {
        // given
        const { written, board } = harness({ rows: 8 })
        for (const line of SUMMARY) {
            board.print(line)
        }

        // when
        board.show(TALL)

        // then
        expect(linesOf(written.at(-1))[0]).toBe(`↑ ${SUMMARY.length} more${CLEAR_TO_END}`)
    })

    it("should write nothing for a prompt's answer, which the prompt drew already", () => {
        // given
        const { written, board } = harness()

        // when
        board.answered("setup:  pnpm i")

        // then
        expect(written).toEqual([])
    })

    it("should rewind over a prompt's answer at the first frame, as over a printed line", () => {
        // given
        const { written, board } = harness()
        board.print("! main is 2 commits behind origin/main")
        board.answered("setup:  pnpm i")
        board.answered("verify: pnpm check")

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(3)}`)).toBe(true)
    })

    it("should draw a prompt's answer in its place among the printed lines above the rows", () => {
        // given
        const { written, board } = harness()
        board.print("! main is 2 commits behind origin/main")
        board.answered("setup:  pnpm i")
        board.answered("verify: pnpm check")
        board.print(SUMMARY[0] ?? "")

        // when
        board.show(VIEW)

        // then
        expect(linesOf(written.at(-1)).slice(0, 4)).toEqual(
            ["! main is 2 commits behind origin/main", "setup:  pnpm i", "verify: pnpm check", SUMMARY[0]].map(
                line => `${line}${CLEAR_TO_END}`,
            ),
        )
    })

    it("should take back on a short window only what cursor-up reaches, prompt answers counted", () => {
        // given
        const { written, board } = harness({ rows: 8 })
        for (let line = 0; line < 5; line++) {
            board.print(`line ${line}`)
        }
        board.answered("setup:  pnpm i")
        board.answered("verify: pnpm check")
        board.print(SUMMARY[0] ?? "")
        board.show(VIEW)

        // when
        board.end()

        // then
        expect(linesOf(written.at(-1)).slice(0, 7)).toEqual(
            ["line 1", "line 2", "line 3", "line 4", "setup:  pnpm i", "verify: pnpm check", SUMMARY[0]].map(
                line => `${line}${CLEAR_TO_END}`,
            ),
        )
    })

    it("should write nothing for a prompt's answer after the first frame", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        const drawn = written.length

        // when
        board.answered("setup:  pnpm i")

        // then
        expect(written.length).toBe(drawn)
    })

    it("should draw a line printed after the first frame as a frame, never into one", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)

        // when
        board.print(LINK)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(2)}`)).toBe(true)
    })

    it("should draw a line printed after the board under the notice", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        board.notice(DRAINING)

        // when
        board.print(LINK)

        // then
        expect(linesOf(written.at(-1)).slice(1, 3)).toEqual([DRAINING.line, LINK].map(line => `${line}${CLEAR_TO_END}`))
    })

    it("should draw an error line said while the board is showing under it", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)

        // when
        board.error("afk: halted")

        // then
        expect(linesOf(written.at(-1))).toContain(`afk: halted${CLEAR_TO_END}`)
    })

    it.each([
        ["an error", [ERROR], `Error - last event ${VIEW.at}`],
        ["an error, then the drain notice", [ERROR, DRAINING], `Error - Draining - last event ${VIEW.at}`],
        ["the drain notice, then an error", [DRAINING, ERROR], `Error - Draining - last event ${VIEW.at}`],
    ] as const)("should prefix the footer with Error once %s was said", (_, said, expected) => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        for (const notice of said) {
            say(board, notice)
        }

        // when
        board.show(VIEW)

        // then
        expect(visible(linesOf(written.at(-1)).at(-1) ?? "")).toBe(expected)
    })

    it.each([
        ["drain notice first", [DRAINING, ERROR]],
        ["error first", [ERROR, DRAINING]],
    ] as const)("should draw the error and the drain notice in arrival order, %s", (_, said) => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        for (const notice of said) {
            say(board, notice)
        }

        // when
        board.print(LINK)

        // then
        expect(linesOf(written.at(-1)).slice(1, 4)).toEqual(
            [...said.map(notice => notice.line), LINK].map(line => `${line}${CLEAR_TO_END}`),
        )
    })

    it("should paint the error notice and its footer prefix at the end", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        board.error("afk: halted")

        // when
        board.end()

        // then
        expect(linesOf(written.at(-1)).slice(1).map(visible)).toEqual([`Error - last event ${VIEW.at}`, "afk: halted"])
    })

    it("should keep an error line said while the board is showing on stderr where stderr is elsewhere", () => {
        // given
        const { errored, board } = harness({ errorsElsewhere: true })
        board.show(VIEW)

        // when
        board.error("afk: halted")

        // then
        expect(errored).toEqual(["afk: halted\n"])
    })

    it("should rewind over an error line said on this terminal before the board, too", () => {
        // given
        const { written, board } = harness()
        board.print(SUMMARY[0] ?? "")
        board.error("afk: --max-parallel is ignored")
        board.print(SUMMARY[1] ?? "")

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(3)}`)).toBe(true)
    })

    it("should write a line printed after a first frame that failed straight through, as nothing was drawn", () => {
        // given
        let failing = true
        const written: string[] = []
        const board = createTerminalBoard({
            write: chunk => {
                if (failing) {
                    throw new Error("EPIPE")
                }
                written.push(chunk)
            },
            writeError: () => undefined,
            errorsElsewhere: false,
            columns: () => 80,
            rows: () => 40,
            onResize: () => undefined,
            ...DETACHED,
        })
        board.show(VIEW)
        failing = false

        // when
        board.print(LINK)

        // then
        expect(written).toEqual([`${LINK}\n`])
    })

    it("should keep an error line off stderr while the board is showing where stderr is the terminal", () => {
        // given
        const { errored, board } = harness()
        board.show(VIEW)

        // when
        board.error("afk: halted")

        // then
        expect(errored).toEqual([])
    })

    it("should write an error line before the first frame to stderr, as ever", () => {
        // given
        const { errored, board } = harness()

        // when
        board.error("afk: refused")

        // then
        expect(errored).toEqual(["afk: refused\n"])
    })

    it("should paint every row at the end, however short the window", () => {
        // given
        const { written, board } = harness({ rows: 8 })
        board.show(TALL)

        // when
        board.end()

        // then
        expect(linesOf(written.at(-1)).length).toBe(TALL.rows.length + 1)
    })

    it.each([
        ["footer directly under the rows", TALL.rows.length, `Draining - last event ${VIEW.at}`],
        ["pull request's link last", -1, LINK],
    ] as const)("should paint the end with the %s", (_, index, expected) => {
        // given
        const { written, board } = harness({ rows: 8 })
        board.show(TALL)
        board.notice(DRAINING)
        board.print(LINK)

        // when
        board.end()

        // then
        expect(visible(linesOf(written.at(-1)).at(index) ?? "")).toBe(expected)
    })

    it("should paint nothing at the end of a process that never showed a board", () => {
        // given
        const { written, board } = harness()
        for (const line of SUMMARY) {
            board.print(line)
        }

        // when
        board.end()

        // then
        expect(written).toEqual(SUMMARY.map(line => `${line}\n`))
    })

    it("should write a line printed after the end straight through", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        board.end()

        // when
        board.print(LINK)

        // then
        expect(written.at(-1)).toBe(`${LINK}\n`)
    })

    it("should swallow a printed line whose write fails", () => {
        // given
        const { board } = harness({ fails: true })

        // when
        const printing = () => board.print(LINK)

        // then
        expect(printing).not.toThrow()
    })
})

/**
 * The operator scrolls the board from its first frame on, where stdin is a terminal: ↑/↓ a line,
 * Home/End to either end, and Ctrl-C, which raw mode keeps from being a signal, forwarded as the
 * process's own (ADR-0041, ADR-0016). The terminal is given back at the end, and on an exit however it comes.
 */
describe("createTerminalBoard: keys", () => {
    const UP_KEY: Key = { name: "up" }
    const DOWN_KEY: Key = { name: "down" }
    const HOME_KEY: Key = { name: "home" }
    const END_KEY: Key = { name: "end" }
    const CTRL_C: Key = { name: "c", ctrl: true }

    /** The top line of the last frame, as the terminal shows it. */
    const topOf = (written: readonly string[]): string => visible(linesOf(written.at(-1)).at(0) ?? "")

    it.each([
        ["↓ scrolls one line down", [DOWN_KEY], "↑ 1 more"],
        ["↓ twice scrolls two lines down", [DOWN_KEY, DOWN_KEY], "↑ 2 more"],
        ["↑ scrolls one line back up", [DOWN_KEY, DOWN_KEY, UP_KEY], "↑ 1 more"],
        ["End jumps to the last line", [END_KEY], "↑ 8 more"],
        ["↓ at the last line stays there", [END_KEY, DOWN_KEY], "↑ 8 more"],
    ] as const)("should redraw at once where %s", (_, keys, expected) => {
        // given
        const { written, board, press } = harness({ rows: 8 })
        board.show(TALL)

        // when
        press(...keys)

        // then
        expect(topOf(written)).toBe(expected)
    })

    it.each([
        ["Home after End", [END_KEY, HOME_KEY]],
        ["↑ at the first line", [UP_KEY]],
        ["↑ back to the first line", [DOWN_KEY, UP_KEY]],
    ] as const)("should show the first line again for %s", (_, keys) => {
        // given
        const { written, board, press } = harness({ rows: 8 })
        board.show(TALL)
        const first = topOf(written)

        // when
        press(...keys)

        // then
        expect(topOf(written)).toBe(first)
    })

    it("should keep the scroll position across a redraw", () => {
        // given
        const { written, board, press } = harness({ rows: 8 })
        board.show(TALL)
        press(DOWN_KEY)

        // when
        board.show(TALL)

        // then
        expect(topOf(written)).toBe("↑ 1 more")
    })

    it("should draw nothing for a key that is not a scroll", () => {
        // given
        const { written, board, press } = harness({ rows: 8 })
        board.show(TALL)
        const drawn = written.length

        // when
        press({ name: "x" })

        // then
        expect(written.length).toBe(drawn)
    })

    it("should forward Ctrl-C as one interrupt of the process's own", () => {
        // given
        const { interrupts, board, press } = harness()
        board.show(VIEW)

        // when
        press(CTRL_C)

        // then
        expect(interrupts.raised).toBe(1)
    })

    it("should take no keys before the first frame", () => {
        // given
        const { stdin, board } = harness()

        // when
        board.print("spec #66: afk/66/spec cut from main")

        // then
        expect(stdin.taken).toBe(false)
    })

    it("should take the keys at the first frame", () => {
        // given
        const { stdin, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(stdin.taken).toBe(true)
    })

    it("should take no keys at a first frame that failed to write", () => {
        // given
        const { stdin, board } = harness({ fails: true })

        // when
        board.show(VIEW)

        // then
        expect(stdin.taken).toBe(false)
    })

    it("should still clip the frame to the window where stdin is not a terminal", () => {
        // given
        const { written, board } = harness({ rows: 8, keyboard: false })

        // when
        board.show(TALL)

        // then
        expect(linesOf(written.at(-1)).length).toBe(7)
    })

    it("should hide the cursor with the first frame", () => {
        // given
        const { written, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)).toContain(HIDE_CURSOR)
    })

    it("should hide the cursor only once", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)).not.toContain(HIDE_CURSOR)
    })

    it.each([
        ["show the cursor", ({ written }: Ended) => written.at(-1)?.includes(SHOW_CURSOR)],
        ["release stdin", ({ stdin }: Ended) => stdin.released],
    ] as const)("should %s at the end, once the last paint is down", (_, observed) => {
        // given
        const ended = harness()
        ended.board.show(VIEW)

        // when
        ended.board.end()

        // then
        expect(observed(ended)).toBe(true)
    })

    it("should release stdin at the end even where the last paint fails to write", () => {
        // given
        let failing = false
        let released = false
        const board = createTerminalBoard({
            write: () => {
                if (failing) {
                    throw new Error("EPIPE")
                }
            },
            writeError: () => undefined,
            errorsElsewhere: false,
            columns: () => 80,
            rows: () => 40,
            onResize: () => undefined,
            ...DETACHED,
            keys: {
                take: () => undefined,
                release: () => {
                    released = true
                },
            },
        })
        board.show(VIEW)
        failing = true

        // when
        board.end()

        // then
        expect(released).toBe(true)
    })

    it("should release nothing at the end of a process that never showed a board", () => {
        // given
        const { stdin, board } = harness()

        // when
        board.end()

        // then
        expect(stdin.released).toBe(false)
    })

    it("should draw nothing for a key pressed after the end", () => {
        // given
        const { written, board, press } = harness({ rows: 8 })
        board.show(TALL)
        board.end()
        const drawn = written.length

        // when
        press(DOWN_KEY)

        // then
        expect(written.length).toBe(drawn)
    })

    it("should show the cursor on an exit while the board is showing, as a kill or a crash is", () => {
        // given
        const { written, board, exit } = harness()
        board.show(VIEW)

        // when
        exit()

        // then
        expect(written.at(-1)).toBe(SHOW_CURSOR)
    })

    it("should write nothing on an exit once the end has shown the cursor", () => {
        // given
        const { written, board, exit } = harness()
        board.show(VIEW)
        board.end()
        const drawn = written.length

        // when
        exit()

        // then
        expect(written.length).toBe(drawn)
    })

    it("should swallow a cursor that fails to be shown on an exit", () => {
        // given
        const { board, exit } = harness({ fails: true })
        board.show(VIEW)

        // when
        const exiting = () => exit()

        // then
        expect(exiting).not.toThrow()
    })
})

/**
 * The line board keeps one thing of its own — the view it was last shown — and everything else
 * about it is `boardLines`, which is asserted as the mapping it is beside this.
 */
describe("createLineBoard", () => {
    const harness = () => {
        const printed: string[] = []
        return { printed, board: createLineBoard({ print: line => printed.push(line) }) }
    }

    const IMPLEMENTED: BoardView = {
        at: VIEW.at,
        rows: VIEW.rows.map(row => ({
            ...row,
            steps: [
                { step: "setup", state: "settled", outcome: "ok" },
                { step: "implement", state: "settled", outcome: "ok" },
            ],
        })),
    }

    it("should print what the view it was last shown made news of", () => {
        // given
        const { printed, board } = harness()
        board.show(VIEW)

        // when
        board.show(IMPLEMENTED)

        // then
        expect(printed).toEqual(["#7 implement ok"])
    })

    it("should print nothing for a notice, which off a terminal keeps stderr", () => {
        // given
        const { printed, board } = harness()
        board.show(VIEW)

        // when
        board.notice(DRAINING)

        // then
        expect(printed).toEqual([])
    })
})
