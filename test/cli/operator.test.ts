import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
import { createTerminalOperator, type TerminalOperatorDeps } from "../../src/cli/operator.ts"
import type { Commands } from "../../src/domain/operator.ts"
import type { Notice } from "../../src/domain/preflight.ts"

const COMMANDS: Commands = { setup: "npm ci", verify: "npm run check" }

/** Ctrl-U: what an operator presses to clear the pre-filled command before typing their own. */
const CLEARED = ""

type Answers = { setup: string; verify: string }

/** An operator over `input`, whose output goes nowhere and whose lines are dropped unless asked for. */
const operatorOn = (
    input: PassThrough,
    {
        output = new PassThrough(),
        print = () => undefined,
        answered = () => undefined,
    }: Partial<TerminalOperatorDeps> = {},
) => createTerminalOperator({ input, output, print, answered })

/**
 * The screen, driven the way a terminal drives it: each answer is typed once its question is on
 * screen. Answering with a bare newline is an operator who kept what was proposed.
 */
const shown = (
    notices: readonly Notice[] = [],
    answers?: Answers,
): { confirmed: Promise<Commands | undefined>; printed: string[]; answered: string[] } => {
    const input = new PassThrough()
    const output = new PassThrough()
    const printed: string[] = []
    const answered: string[] = []
    const asked = { setup: false, verify: false }

    // A terminal answers a prompt later, never inside the write that drew it, so the typing is
    // deferred: a stream in flowing mode would otherwise deliver it before the question is ready.
    const type = (answer: string): void => {
        setImmediate(() => input.write(answer))
    }

    output.setEncoding("utf8")
    output.on("data", (chunk: string) => {
        if (!asked.setup && chunk.includes("setup:")) {
            asked.setup = true
            type(answers === undefined ? "\n" : `${CLEARED}${answers.setup}\n`)
            return
        }
        if (asked.setup && !asked.verify && chunk.includes("verify:")) {
            asked.verify = true
            type(answers === undefined ? "\n" : `${CLEARED}${answers.verify}\n`)
        }
    })

    const operator = operatorOn(input, {
        output,
        print: line => printed.push(line),
        answered: line => answered.push(line),
    })
    return { confirmed: operator.confirm({ notices, commands: COMMANDS }), printed, answered }
}

describe("createTerminalOperator().confirm", () => {
    it("should keep the proposed command when the answer is empty", async () => {
        // given
        const { confirmed } = shown()

        // when
        const commands = await confirmed

        // then
        expect(commands).toEqual(COMMANDS)
    })

    it("should run what the operator typed over what was proposed", async () => {
        // given
        const { confirmed } = shown([], { setup: "pnpm i", verify: "pnpm check" })

        // when
        const commands = await confirmed

        // then
        expect(commands).toEqual({ setup: "pnpm i", verify: "pnpm check" })
    })

    it("should show the warnings before asking anything", async () => {
        // given
        const warning: Notice = { kind: "warning", message: "main is 2 commits behind origin/main" }
        const { confirmed, printed } = shown([warning])

        // when
        await confirmed

        // then
        expect(printed[0]).toBe("! main is 2 commits behind origin/main")
    })

    it.each([
        [undefined, ["setup:  npm ci", "verify: npm run check"]],
        [{ setup: "pnpm i", verify: "pnpm check" }, ["setup:  pnpm i", "verify: pnpm check"]],
    ] as const)("should hand on both answered lines as they stand, in order, for %j", async (answers, expected) => {
        // given
        const { confirmed, answered } = shown([], answers)

        // when
        await confirmed

        // then
        expect(answered).toEqual(expected)
    })

    it("should abort when the input closes instead of deciding", async () => {
        // given
        const input = new PassThrough()
        const operator = operatorOn(input)
        const confirmed = operator.confirm({ notices: [], commands: COMMANDS })

        // when
        input.end()

        // then
        await expect(confirmed).resolves.toBeUndefined()
    })

    it("should hand on no line when the input closes instead of deciding", async () => {
        // given
        const input = new PassThrough()
        const answered: string[] = []
        const operator = operatorOn(input, { answered: line => answered.push(line) })
        const confirmed = operator.confirm({ notices: [], commands: COMMANDS })

        // when
        input.end()
        await confirmed

        // then
        expect(answered).toEqual([])
    })
})

describe("createTerminalOperator().report", () => {
    it("should tell the operator what the notes say without asking anything", async () => {
        // given
        const printed: string[] = []
        const operator = operatorOn(new PassThrough(), { print: line => printed.push(line) })

        // when
        await operator.report([{ kind: "note", message: "main is 1 commit ahead of origin/main" }])

        // then
        expect(printed).toEqual(["- main is 1 commit ahead of origin/main"])
    })
})

/** The takeover offer, answered with `answer` once the question is on screen. */
const offered = (answer: string, answered: (line: string) => void = () => undefined): Promise<boolean> => {
    const input = new PassThrough()
    const output = new PassThrough()
    let asked = false
    output.setEncoding("utf8")
    output.on("data", (chunk: string) => {
        if (!asked && chunk.includes("Take it over?")) {
            asked = true
            setImmediate(() => input.write(`${answer}\n`))
        }
    })
    const operator = operatorOn(input, { output, answered })
    return operator.takeOver(4, { pid: 7 })
}

describe("createTerminalOperator().takeOver", () => {
    it.each([
        ["y", true],
        ["yes", true],
        ["Y", true],
        ["", false],
        ["n", false],
        ["no", false],
        ["sure", false],
    ] as const)("should take over on %j only where it is a yes", async (answer, expected) => {
        // given
        const answered = offered(answer)

        // when
        const accepted = await answered

        // then
        expect(accepted).toBe(expected)
    })

    it("should hand on the answered question's line as it stands", async () => {
        // given
        const answered: string[] = []
        const accepted = offered("y", line => answered.push(line))

        // when
        await accepted

        // then
        expect(answered).toEqual(["spec #4 is already being run by afk process 7. Take it over? [y/N] y"])
    })

    it("should decline when the input closes instead of deciding", async () => {
        // given
        const input = new PassThrough()
        const operator = operatorOn(input)
        const accepted = operator.takeOver(4, { pid: 7 })

        // when
        input.end()

        // then
        await expect(accepted).resolves.toBe(false)
    })
})
