import { createInterface, type Interface } from "node:readline/promises"
import type { Operator } from "../domain/operator.ts"
import type { Notice } from "../domain/preflight.ts"

/**
 * The confirmation screen, on a terminal.
 *
 * The proposal is written into the line buffer once the question is on screen, so it is edited in
 * place rather than retyped, and an empty answer keeps it. The DAG is not shown for editing and no
 * external editor is opened: the one thing being decided here is the pair of commands that will run
 * on this machine (ADR-0014).
 */

export type TerminalOperatorDeps = {
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
    print: (line: string) => void
}

const shown = (notice: Notice): string => `${notice.kind === "warning" ? "!" : "-"} ${notice.message}`

/**
 * Undefined when the input closed — a terminal that went away, or an operator who pressed ctrl-c —
 * which is the abort half of the one accept-or-abort decision this screen carries.
 */
const ask = async (readline: Interface, question: string, proposed: string): Promise<string | undefined> => {
    const answered = readline.question(question)
    readline.write(proposed)

    const closed = new Promise<undefined>(resolve => readline.once("close", () => resolve(undefined)))
    const answer = await Promise.race([answered, closed])
    if (answer === undefined) {
        return undefined
    }

    return answer.trim() === "" ? proposed : answer.trim()
}

export const createTerminalOperator = ({ input, output, print }: TerminalOperatorDeps): Operator => {
    const report = async (notices: readonly Notice[]): Promise<void> => {
        for (const notice of notices) {
            print(shown(notice))
        }
    }

    return {
        report,
        confirm: async ({ notices, commands }) => {
            await report(notices)
            if (notices.length > 0) {
                print("")
            }

            const readline = createInterface({ input, output, terminal: true })
            readline.once("SIGINT", () => readline.close())
            try {
                const setup = await ask(readline, "setup:  ", commands.setup)
                const verify = setup === undefined ? undefined : await ask(readline, "verify: ", commands.verify)
                return setup === undefined || verify === undefined ? undefined : { setup, verify }
            } finally {
                readline.close()
            }
        },
    }
}
