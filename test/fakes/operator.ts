import type { Commands, ConfirmationScreen, Operator } from "../../src/domain/operator.ts"
import type { Notice } from "../../src/domain/preflight.ts"

export type FakeOperator = {
    operator: Operator
    /** Every confirmation screen shown. */
    screens: ConfirmationScreen[]
    /** Every set of notices reported without a question. */
    reported: (readonly Notice[])[]
}

/** `answer` is what the operator did with the screen: commands of their own, or undefined to abort. */
export const createFakeOperator = (answer?: Commands | undefined, aborts = false): FakeOperator => {
    const screens: ConfirmationScreen[] = []
    const reported: (readonly Notice[])[] = []
    return {
        screens,
        reported,
        operator: {
            report: async notices => {
                reported.push(notices)
            },
            confirm: async screen => {
                screens.push(screen)
                return aborts ? undefined : (answer ?? screen.commands)
            },
        },
    }
}
