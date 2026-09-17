import type { StartFresh } from "../../src/service/fresh.ts"

/**
 * A start-over that throws nothing away, for the tests whose invocation does not ask for one. The
 * driving port is stubbed rather than faked: there is no port contract to keep honest here, only a
 * use case a test does not want to invoke.
 */
export const createStubFresh = (): StartFresh => async () => ({ outcome: "cleared", pullRequest: false })
