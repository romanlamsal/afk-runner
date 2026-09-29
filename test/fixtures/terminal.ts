import * as xterm from "@xterm/headless"
import type { TerminalBoardDeps } from "../../src/cli/board-writer.ts"

/**
 * A terminal emulator in place of the operator's: what the writer's output looks like once a
 * terminal has made of it — the screen, the scrollback and which of the two buffers is showing.
 * xterm.js rather than Konsole or any other, so a quirk only another terminal has is not caught here.
 *
 * Writes are applied in the order they were made. A tty turns every `\n` into `\r\n` on its way out
 * (ONLCR), and this does the same, since the writer relies on it.
 */
export type EmulatedTerminal = Pick<TerminalBoardDeps, "write" | "rows" | "columns" | "onResize"> & {
    /** The window resized, once every write before it is applied, and then its listeners told. */
    resize: (to: { rows?: number; columns?: number }) => Promise<void>
    /** Every write so far, applied. */
    settled: () => Promise<void>
    /** The rows showing now, in the buffer showing now, without their trailing blanks. */
    screen: () => Promise<readonly string[]>
    /** The main buffer, scrollback and screen, without trailing blanks and trailing empty rows. */
    main: () => Promise<readonly string[]>
    /** Whether the alternate screen is the one showing. */
    alternate: () => Promise<boolean>
}

export const emulatedTerminal = ({ rows, columns }: { rows: number; columns: number }): EmulatedTerminal => {
    const terminal = new xterm.Terminal({ rows, cols: columns, scrollback: 1000, allowProposedApi: true })
    const listeners: (() => void)[] = []
    let applied = Promise.resolve()

    const write = (chunk: string): void => {
        const onTheWire = chunk.replaceAll("\n", "\r\n")
        applied = applied.then(() => new Promise<void>(resolve => terminal.write(onTheWire, resolve)))
    }

    const settled = (): Promise<void> => applied

    const linesOf = (from: number, to: number, buffer = terminal.buffer.active): string[] =>
        Array.from({ length: Math.max(to - from, 0) }, (_, index) =>
            (buffer.getLine(from + index)?.translateToString(true) ?? "").trimEnd(),
        )

    return {
        write,
        rows: () => terminal.rows,
        columns: () => terminal.cols,
        resize: async to => {
            await settled()
            terminal.resize(to.columns ?? terminal.cols, to.rows ?? terminal.rows)
            for (const listener of listeners) {
                listener()
            }
            await settled()
        },
        onResize: listener => listeners.push(listener),
        settled,
        screen: async () => {
            await settled()
            const buffer = terminal.buffer.active
            return linesOf(buffer.viewportY, buffer.viewportY + terminal.rows)
        },
        main: async () => {
            await settled()
            const buffer = terminal.buffer.normal
            const lines = linesOf(0, buffer.length, buffer)
            while (lines.at(-1) === "") {
                lines.pop()
            }
            return lines
        },
        alternate: async () => {
            await settled()
            return terminal.buffer.active.type === "alternate"
        },
    }
}
