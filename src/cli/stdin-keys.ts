import { emitKeypressEvents, type Key } from "node:readline"
import type { ReadStream } from "node:tty"
import type { KeySource } from "./board-writer.ts"

/**
 * A terminal's stdin as the board's keyboard: Node's keypress events in raw mode, so that keystrokes
 * are neither echoed into the frame nor held back for a line. Resumed, because a closed prompt left
 * it paused. Not unit-tested: it is the real terminal and nothing else.
 */
export const stdinKeys = (stdin: ReadStream): KeySource => ({
    take: listener => {
        // A no-op where a prompt's readline already attached the decoder, which is closed by now.
        emitKeypressEvents(stdin)
        stdin.on("keypress", (_: string | undefined, key: Key | undefined) => {
            if (key !== undefined) {
                listener(key)
            }
        })
        stdin.setRawMode(true)
        stdin.resume()
    },
    release: () => {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.unref()
    },
})
