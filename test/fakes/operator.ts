import type { Holder } from "../../src/domain/lock.ts"
import type { Commands, ConfirmationScreen, Operator } from "../../src/domain/operator.ts"
import type { Notice } from "../../src/domain/preflight.ts"

export type FakeOperator = {
    operator: Operator
    /** Every confirmation screen shown. */
    screens: ConfirmationScreen[]
    /** Every set of notices reported without a question. */
    reported: (readonly Notice[])[]
    /** Every takeover offered: which spec, and who held it. */
    offers: { spec: number; holder: Holder }[]
}

export type FakeOperatorSetup = {
    /** What the operator did with the screen: commands of their own, or nothing to keep what was proposed. */
    answer?: Commands | undefined
    /** Whether they closed the screen instead of deciding. */
    aborts?: boolean
    /** What they said to taking over a live run. */
    takesOver?: boolean
}

export const createFakeOperator = ({
    answer,
    aborts = false,
    takesOver = false,
}: FakeOperatorSetup = {}): FakeOperator => {
    const screens: ConfirmationScreen[] = []
    const reported: (readonly Notice[])[] = []
    const offers: { spec: number; holder: Holder }[] = []
    return {
        screens,
        reported,
        offers,
        operator: {
            report: async notices => {
                reported.push(notices)
            },
            confirm: async screen => {
                screens.push(screen)
                return aborts ? undefined : (answer ?? screen.commands)
            },
            takeOver: async (spec, holder) => {
                offers.push({ spec, holder })
                return takesOver
            },
        },
    }
}
