import type { ShowBoard } from "../../src/service/board.ts"

/**
 * A viewer that draws nothing, for the tests whose invocation does not ask for a board. The driving
 * port is stubbed rather than faked: there is no port contract to keep honest here, only a use case
 * a test does not want to invoke.
 */
export const createStubShowBoard = (): ShowBoard => async () => ({ outcome: "shown", whole: true })
