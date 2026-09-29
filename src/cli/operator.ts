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
    /**
     * A prompt's line as it stands once its readline has closed, handed on because readline drew it
     * and nothing else counted it: the board takes it into what scrolls with it (ADR-0041).
     */
    answered: (line: string) => void
}

/** Only a yes is a yes, so that nobody takes a run over by hitting return (ADR-0035). */
const YES = /^y(es)?$/i

const shown = (notice: Notice): string => `${notice.kind === "warning" ? "!" : "-"} ${notice.message}`

/** A question and what was typed at it, which is its line as it stands on screen once answered. */
type Asked = { question: string; typed: string }

/**
 * What was typed, as typed. Undefined when the input closed — a terminal that went away, or an
 * operator who pressed ctrl-c — which is the abort half of the one accept-or-abort decision this
 * screen carries.
 */
const ask = async (readline: Interface, question: string, proposed: string): Promise<Asked | undefined> => {
    const typing = readline.question(question)
    readline.write(proposed)

    const closed = new Promise<undefined>(resolve => readline.once("close", () => resolve(undefined)))
    const typed = await Promise.race([typing, closed])
    return typed === undefined ? undefined : { question, typed }
}

/** An empty answer keeps what was proposed. */
const kept = ({ typed }: Asked, proposed: string): string => (typed.trim() === "" ? proposed : typed.trim())

const lineOf = ({ question, typed }: Asked): string => `${question}${typed}`

export const createTerminalOperator = ({ input, output, print, answered }: TerminalOperatorDeps): Operator => {
    /** One readline for `asking`, closed once it is done or aborted, whichever comes first. */
    const session = async <T>(asking: (readline: Interface) => Promise<T>): Promise<T> => {
        const readline = createInterface({ input, output, terminal: true })
        readline.once("SIGINT", () => readline.close())
        try {
            return await asking(readline)
        } finally {
            readline.close()
        }
    }

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

            const { setup, verify } = await session(async readline => {
                const setup = await ask(readline, "setup:  ", commands.setup)
                return {
                    setup,
                    verify: setup === undefined ? undefined : await ask(readline, "verify: ", commands.verify),
                }
            })
            // An aborted screen is the end of the run, so its half-answered lines stay readline's.
            if (setup === undefined || verify === undefined) {
                return undefined
            }
            answered(lineOf(setup))
            answered(lineOf(verify))
            return { setup: kept(setup, commands.setup), verify: kept(verify, commands.verify) }
        },
        takeOver: async (spec, holder) => {
            const answer = await session(readline =>
                ask(
                    readline,
                    `spec #${spec} is already being run by afk process ${holder.pid}. Take it over? [y/N] `,
                    "",
                ),
            )
            if (answer === undefined) {
                return false
            }
            answered(lineOf(answer))
            return YES.test(answer.typed.trim())
        },
    }
}
